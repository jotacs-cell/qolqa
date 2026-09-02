const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool, conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

const RUC_REGEX = /^\d{11}$/;
const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

function firmarToken({ userId, companyId, roleId, esSuperAdmin }) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, companyId, roleId, jti, esSuperAdmin: !!esSuperAdmin }, process.env.JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
  return { token, jti };
}

/**
 * Registro (colapsa los pasos 1, 2 y 5 del onboarding de la arquitectura —
 * cuenta + empresa + primer usuario admin — en una sola llamada atómica;
 * el asistente de varios pasos del frontend es quien decide en qué orden
 * pedir estos datos, pero técnicamente todo se confirma junto o nada).
 */
async function registrar(req, res) {
  const { nombres, apellidos, correo, password, empresa } = req.body;

  if (!nombres || !apellidos || !correo || !password) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombres, apellidos, correo y password son requeridos.');
  }
  if (!CORREO_REGEX.test(correo)) throw new ApiError(422, 'CORREO_INVALIDO', 'El correo no tiene un formato válido.');
  if (password.length < 8) throw new ApiError(422, 'PASSWORD_DEBIL', 'La contraseña debe tener al menos 8 caracteres.');
  if (!empresa || !empresa.ruc || !empresa.razon_social) {
    throw new ApiError(422, 'EMPRESA_INCOMPLETA', 'empresa.ruc y empresa.razon_social son requeridos.');
  }
  if (!RUC_REGEX.test(empresa.ruc)) throw new ApiError(422, 'RUC_INVALIDO', 'El RUC debe tener 11 dígitos.');

  const { rows: existente } = await pool.query('SELECT id FROM users WHERE correo = $1', [correo]);
  if (existente[0]) throw new ApiError(409, 'CORREO_EN_USO', 'Ya existe una cuenta con ese correo.');

  const { rows: rucExistente } = await pool.query('SELECT id FROM companies WHERE ruc = $1', [empresa.ruc]);
  if (rucExistente[0]) throw new ApiError(409, 'RUC_EN_USO', 'Ese RUC ya está registrado en Qolqa.');

  const { rows: rolAdminRows } = await pool.query(
    "SELECT id FROM roles WHERE company_id IS NULL AND nombre = 'admin'"
  );
  const rolAdmin = rolAdminRows[0];
  if (!rolAdmin) {
    // No debería pasar nunca en un entorno migrado correctamente — pero si
    // el rol plantilla no existe, es mejor un 500 explícito que una empresa
    // sin nadie que la administre.
    throw new ApiError(500, 'ROL_ADMIN_NO_SEMBRADO', 'Falta sembrar el rol "admin" — corre npm run db:seed.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows: userRows } = await pool.query(
    `INSERT INTO users (nombres, apellidos, correo, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [nombres, apellidos, correo, passwordHash]
  );
  const userId = userRows[0].id;

  // crear_empresa() es la única vía permitida para crear una empresa nueva
  // — ver la nota de seguridad junto a su definición en schema.sql.
  const { rows: companyRows } = await pool.query('SELECT crear_empresa($1, $2, $3, $4, $5, $6) AS id', [
    `Cuenta de ${nombres} ${apellidos}`,
    userId,
    empresa.ruc,
    empresa.razon_social,
    empresa.nombre_comercial || null,
    rolAdmin.id,
  ]);
  const companyId = companyRows[0].id;

  const { token, jti } = firmarToken({ userId, companyId, roleId: rolAdmin.id });

  await conContexto({ userId, companyId }, async (client) => {
    await client.query(
      `INSERT INTO sessions (user_id, company_id, jti, dispositivo, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, companyId, jti, req.headers['user-agent'] || null, req.ip]
    );
    await auditoria.registrar(client, {
      companyId,
      userId,
      accion: 'empresa.crear',
      entidad: 'company',
      entidadId: companyId,
      valorNuevo: { ruc: empresa.ruc, razon_social: empresa.razon_social },
      ip: req.ip,
    });
  });

  res.status(201).json({
    token,
    usuario: { id: userId, nombres, apellidos, correo },
    empresa: { id: companyId, ruc: empresa.ruc, razon_social: empresa.razon_social },
  });
}

/**
 * Login. Si el usuario pertenece a más de una empresa y no mandó
 * `company_id`, NO emite token todavía — devuelve la lista para que el
 * frontend muestre el selector (punto 27: "al iniciar sesión, seleccionar
 * empresa"). Vuelve a llamarse a este mismo endpoint con company_id una
 * vez elegida.
 */
async function login(req, res) {
  const { correo, password, company_id } = req.body;
  if (!correo || !password) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'correo y password son requeridos.');

  const { rows } = await pool.query('SELECT * FROM users WHERE correo = $1', [correo]);
  const user = rows[0];
  const credencialesInvalidas = () => new ApiError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');

  if (!user) throw credencialesInvalidas();
  const coincide = await bcrypt.compare(password, user.password_hash);
  if (!coincide) throw credencialesInvalidas();
  if (user.estado !== 'activo') throw new ApiError(403, 'USUARIO_INACTIVO', 'Tu cuenta está inactiva.');

  const { rows: memberships } = await conContexto({ userId: user.id }, (client) =>
    client.query(
      `SELECT m.company_id, m.role_id, c.razon_social, c.nombre_comercial
         FROM user_memberships($1) m
         JOIN companies c ON c.id = m.company_id
        WHERE m.activo`,
      [user.id]
    )
  );

  if (memberships.length === 0) {
    throw new ApiError(403, 'SIN_EMPRESA', 'Tu usuario no pertenece a ninguna empresa activa.');
  }

  let elegida = memberships[0];
  if (memberships.length > 1) {
    if (!company_id) {
      return res.json({
        requiere_seleccion_empresa: true,
        empresas: memberships.map((m) => ({
          id: m.company_id,
          razon_social: m.razon_social,
          nombre_comercial: m.nombre_comercial,
        })),
      });
    }
    elegida = memberships.find((m) => m.company_id === company_id);
    if (!elegida) throw new ApiError(403, 'EMPRESA_NO_PERTENECE', 'No perteneces a esa empresa.');
  }

  const { token, jti } = firmarToken({
    userId: user.id,
    companyId: elegida.company_id,
    roleId: elegida.role_id,
    esSuperAdmin: user.es_superadmin,
  });

  await conContexto({ userId: user.id, companyId: elegida.company_id }, async (client) => {
    await client.query(
      `INSERT INTO sessions (user_id, company_id, jti, dispositivo, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, elegida.company_id, jti, req.headers['user-agent'] || null, req.ip]
    );
    await auditoria.registrar(client, {
      companyId: elegida.company_id,
      userId: user.id,
      accion: 'auth.login',
      entidad: 'user',
      entidadId: user.id,
      ip: req.ip,
    });
  });

  res.json({
    token,
    usuario: {
      id: user.id,
      nombres: user.nombres,
      apellidos: user.apellidos,
      correo: user.correo,
      es_superadmin: user.es_superadmin,
    },
    empresa: { id: elegida.company_id, razon_social: elegida.razon_social },
  });
}

/** Cambia de empresa activa sin volver a pedir contraseña — emite un token
 * nuevo con el company_id/role_id de la empresa destino. La sesión anterior
 * (la de la empresa que deja) sigue viva hasta que expire o se cierre. */
async function cambiarEmpresa(req, res) {
  const { company_id } = req.body;
  if (!company_id) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'company_id es requerido.');

  const { rows } = await pool.query(
    `SELECT m.company_id, m.role_id, c.razon_social
       FROM user_memberships($1) m
       JOIN companies c ON c.id = m.company_id
      WHERE m.activo AND m.company_id = $2`,
    [req.usuario.id, company_id]
  );
  const destino = rows[0];
  if (!destino) throw new ApiError(403, 'EMPRESA_NO_PERTENECE', 'No perteneces a esa empresa.');

  const { token, jti } = firmarToken({
    userId: req.usuario.id,
    companyId: destino.company_id,
    roleId: destino.role_id,
    esSuperAdmin: req.usuario.esSuperAdmin,
  });

  await conContexto({ userId: req.usuario.id, companyId: destino.company_id }, async (client) => {
    await client.query(
      `INSERT INTO sessions (user_id, company_id, jti, dispositivo, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.usuario.id, destino.company_id, jti, req.headers['user-agent'] || null, req.ip]
    );
  });

  res.json({ token, empresa: { id: destino.company_id, razon_social: destino.razon_social } });
}

/** Lista las empresas del usuario autenticado — el contenido del selector
 * de la barra lateral. Se apoya en la política companies_visible: basta con
 * fijar app.user_id, sin fijar app.company_id, para ver todas las propias. */
async function misEmpresas(req, res) {
  const empresas = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('SELECT id, ruc, razon_social, nombre_comercial, logo_url FROM companies ORDER BY razon_social');
    return rows;
  });
  res.json(empresas);
}

async function logout(req, res) {
  await conContexto({ userId: req.usuario.id }, async (client) => {
    await client.query('UPDATE sessions SET revocada_en = now() WHERE jti = $1 AND revocada_en IS NULL', [req.usuario.jti]);
  });
  res.status(204).send();
}

async function misSesiones(req, res) {
  const sesiones = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT id, dispositivo, ip, creado_en, ultimo_uso_en, (jti = $1) AS es_esta_sesion
         FROM sessions WHERE user_id = $2 AND revocada_en IS NULL ORDER BY ultimo_uso_en DESC`,
      [req.usuario.jti, req.usuario.id]
    );
    return rows;
  });
  res.json(sesiones);
}

async function cerrarSesion(req, res) {
  const revocada = await conContexto({ userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `UPDATE sessions SET revocada_en = now()
        WHERE id = $1 AND user_id = $2 AND revocada_en IS NULL RETURNING id`,
      [req.params.id, req.usuario.id]
    );
    return rows[0];
  });
  if (!revocada) throw new ApiError(404, 'NO_ENCONTRADA', 'Sesión no encontrada.');
  res.status(204).send();
}

async function me(req, res) {
  const { rows } = await pool.query(
    'SELECT id, nombres, apellidos, correo, es_superadmin FROM users WHERE id = $1',
    [req.usuario.id]
  );
  const usuario = rows[0];
  if (!usuario) throw new ApiError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');

  const { empresa, rol } = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows: companyRows } = await client.query('SELECT id, razon_social, nombre_comercial FROM companies WHERE id = $1', [
      req.usuario.companyId,
    ]);
    const { rows: rolRows } = await client.query('SELECT id, nombre FROM roles WHERE id = $1', [req.usuario.roleId]);
    return { empresa: companyRows[0] || null, rol: rolRows[0] || null };
  });

  res.json({ usuario, empresa, rol });
}

/** Autoservicio: el usuario cambia su propia contraseña (requiere la
 * actual). Usado hoy por la vista "Configuración" del panel de super
 * admin, pero no tiene nada específico de super admin — sirve para
 * cualquier usuario autenticado. */
async function cambiarPassword(req, res) {
  const { password_actual, password_nueva } = req.body;
  if (!password_actual || !password_nueva) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'password_actual y password_nueva son requeridos.');
  }
  if (password_nueva.length < 8) {
    throw new ApiError(422, 'PASSWORD_DEBIL', 'La nueva contraseña debe tener al menos 8 caracteres.');
  }

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.usuario.id]);
  const usuario = rows[0];
  if (!usuario) throw new ApiError(404, 'NO_ENCONTRADO', 'Usuario no encontrado.');

  const coincide = await bcrypt.compare(password_actual, usuario.password_hash);
  if (!coincide) throw new ApiError(401, 'PASSWORD_ACTUAL_INCORRECTA', 'Tu contraseña actual es incorrecta.');

  const hash = await bcrypt.hash(password_nueva, 12);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
  res.json({ ok: true });
}

module.exports = {
  registrar,
  login,
  cambiarEmpresa,
  misEmpresas,
  logout,
  misSesiones,
  cerrarSesion,
  me,
  cambiarPassword,
};
