const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { PERMISOS } = require('../config/permisos');
const auditoria = require('../services/auditoria.service');

const SALT_ROUNDS = 12;
const ROLES_VALIDOS = ['admin', 'vendedor', 'cajero', 'contador'];

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'email y password son requeridos.');
  }

  const { rows } = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.rol, u.activo, u.company_id,
            e.razon_social, e.nombre_comercial
       FROM usuarios u JOIN empresas e ON e.id = u.company_id
      WHERE u.email = $1`,
    [email]
  );
  const usuario = rows[0];

  // Mismo mensaje para "no existe" y "password incorrecta": no revelamos cuál de las dos falló.
  if (!usuario || !(await bcrypt.compare(password, usuario.password_hash))) {
    throw new ApiError(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.');
  }
  if (!usuario.activo) {
    throw new ApiError(403, 'USUARIO_DESACTIVADO', 'Esta cuenta está desactivada.');
  }

  // Un jti por login: es lo que permite "control de sesiones" — ver esta
  // sesión en la lista y poder cerrarla sin esperar a que el JWT expire.
  const jti = crypto.randomUUID();
  await pool.query(
    `INSERT INTO sesiones (usuario_id, jti, dispositivo, ip)
     VALUES ($1, $2, $3, $4)`,
    [usuario.id, jti, (req.headers['user-agent'] || '').slice(0, 200), req.ip]
  );

  const payload = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    companyId: usuario.company_id,
    jti,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

  await auditoria.registrar({
    companyId: usuario.company_id,
    usuarioId: usuario.id,
    accion: 'auth.login',
    entidad: 'usuario',
    entidadId: usuario.id,
  });

  res.json({
    token,
    expira_en: process.env.JWT_EXPIRES_IN || '8h',
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
    empresa: { id: usuario.company_id, razon_social: usuario.razon_social, nombre_comercial: usuario.nombre_comercial },
  });
}

/** Revoca la sesión actual (la del token con el que se llama este endpoint). */
async function logout(req, res) {
  if (req.usuario.jti) {
    await pool.query('UPDATE sesiones SET revocada_en = now() WHERE jti = $1 AND revocada_en IS NULL', [req.usuario.jti]);
  }
  res.status(204).send();
}

/** Lista tus propias sesiones activas; admin puede ver las de cualquiera con ?usuario_id=. */
async function listarSesiones(req, res) {
  // "Admin puede ver las de cualquiera" significa cualquiera DE SU MISMA
  // EMPRESA — el join con usuarios exige u.company_id = req.usuario.companyId
  // para que no pueda pedir usuario_id de otra empresa adivinando el id.
  const usuarioIdFiltro = req.usuario.rol === 'admin' && req.query.usuario_id
    ? Number(req.query.usuario_id)
    : req.usuario.id;

  const { rows } = await pool.query(
    `SELECT s.id, s.dispositivo, s.ip, s.creado_en, s.ultimo_uso_en, u.nombre AS usuario_nombre
       FROM sesiones s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.usuario_id = $1 AND u.company_id = $2 AND s.revocada_en IS NULL
      ORDER BY s.ultimo_uso_en DESC`,
    [usuarioIdFiltro, req.usuario.companyId]
  );
  res.json(rows);
}

/** Cierra una sesión puntual (la propia, o cualquiera de tu empresa si eres admin). */
async function cerrarSesion(req, res) {
  const { rows } = await pool.query(
    `SELECT s.usuario_id, u.company_id
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = $1`,
    [req.params.id]
  );
  if (!rows[0] || rows[0].company_id !== req.usuario.companyId) {
    throw new ApiError(404, 'NO_ENCONTRADA', 'Esa sesión no existe.');
  }
  if (rows[0].usuario_id !== req.usuario.id && req.usuario.rol !== 'admin') {
    throw new ApiError(403, 'PROHIBIDO', 'Solo puedes cerrar tus propias sesiones (o ser admin).');
  }

  await pool.query('UPDATE sesiones SET revocada_en = now() WHERE id = $1', [req.params.id]);
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id, accion: 'auth.cerrar_sesion', entidad: 'sesion', entidadId: Number(req.params.id),
    detalle: { de_usuario_id: rows[0].usuario_id },
  });
  res.status(204).send();
}

/** Lista los usuarios de la empresa del token — para el panel "Usuarios y
 * roles" de Configuración. Incluye el nombre de sucursal (si tiene) en
 * vez de solo el id, para no obligar al frontend a cruzarlo aparte. */
async function listarUsuarios(req, res) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.sucursal_id, s.nombre AS sucursal_nombre, u.creado_en
       FROM usuarios u
       LEFT JOIN sucursales s ON s.id = u.sucursal_id
      WHERE u.company_id = $1
      ORDER BY u.nombre`,
    [req.usuario.companyId]
  );
  res.json({ data: rows });
}

async function crearUsuario(req, res) {
  const { nombre, email, password, rol, sucursal_id } = req.body;
  if (!nombre || !email || !password || !rol) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre, email, password y rol son requeridos.');
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new ApiError(422, 'ROL_INVALIDO', `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}.`);
  }
  if (password.length < 8) {
    throw new ApiError(422, 'PASSWORD_DEBIL', 'La contraseña debe tener al menos 8 caracteres.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const { rows } = await pool.query(
      `INSERT INTO usuarios (company_id, nombre, email, password_hash, rol, sucursal_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, email, rol, sucursal_id, activo, creado_en`,
      [req.usuario.companyId, nombre, email, passwordHash, rol, sucursal_id || null]
    );
    await auditoria.registrar({
      companyId: req.usuario.companyId,
      usuarioId: req.usuario.id, accion: 'usuario.crear', entidad: 'usuario', entidadId: rows[0].id,
      detalle: { nombre, rol },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      throw new ApiError(409, 'EMAIL_DUPLICADO', 'Ese email ya está registrado.');
    }
    throw err;
  }
}

async function actualizarUsuario(req, res) {
  const { nombre, email, rol } = req.body;
  if (rol != null && !ROLES_VALIDOS.includes(rol)) {
    throw new ApiError(422, 'ROL_INVALIDO', `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}.`);
  }

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET
         nombre = COALESCE($1, nombre),
         email = COALESCE($2, email),
         rol = COALESCE($3, rol),
         actualizado_en = now()
       WHERE id = $4 AND company_id = $5
       RETURNING id, nombre, email, rol, activo`,
      [nombre || null, email || null, rol || null, req.params.id, req.usuario.companyId]
    );
    if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');

    await auditoria.registrar({
      companyId: req.usuario.companyId,
      usuarioId: req.usuario.id, accion: 'usuario.actualizar', entidad: 'usuario', entidadId: rows[0].id,
      detalle: { nombre, email, rol },
    });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'EMAIL_DUPLICADO', 'Ese email ya está registrado.');
    throw err;
  }
}

async function cambiarEstadoUsuario(req, res) {
  const { activo } = req.body;
  if (typeof activo !== 'boolean') throw new ApiError(422, 'DATOS_INCOMPLETOS', 'activo debe ser true o false.');

  const { rows } = await pool.query(
    'UPDATE usuarios SET activo = $1, actualizado_en = now() WHERE id = $2 AND company_id = $3 RETURNING id, nombre, rol, activo',
    [activo, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');

  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id, accion: activo ? 'usuario.reactivar' : 'usuario.desactivar',
    entidad: 'usuario', entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

function permisos(req, res) {
  res.json(PERMISOS);
}

async function me(req, res) {
  res.json(req.usuario);
}

module.exports = { login, logout, listarSesiones, cerrarSesion, listarUsuarios, crearUsuario, actualizarUsuario, cambiarEstadoUsuario, permisos, me };
