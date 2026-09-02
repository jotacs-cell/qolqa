const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool, conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function listar(req, res) {
  const usuarios = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT cu.id AS membresia_id, u.id AS usuario_id, u.nombres, u.apellidos, u.correo,
              r.id AS rol_id, r.nombre AS rol, b.nombre AS sucursal, cu.activo, cu.unido_en
         FROM company_users cu
         JOIN users u ON u.id = cu.user_id
         JOIN roles r ON r.id = cu.role_id
    LEFT JOIN branches b ON b.id = cu.branch_id
        ORDER BY u.nombres`
    );
    return rows;
  });
  res.json(usuarios);
}

/**
 * Invita a alguien a la empresa activa. Si el correo ya existe como
 * usuario (porque trabaja en otra empresa de Qolqa), se reutiliza esa
 * persona — el correo es único a nivel de plataforma (ver schema.sql) — y
 * solo se agrega una fila nueva en company_users. Si no existe, se crea
 * con una contraseña temporal que se devuelve UNA sola vez en la
 * respuesta: todavía no hay envío de correo (eso depende de la cola de
 * BullMQ de la Fase 2 en adelante) así que, por ahora, el administrador
 * es quien se la comparte a la persona invitada.
 */
async function invitar(req, res) {
  const { correo, nombres, apellidos, role_id, branch_id } = req.body;
  if (!correo || !role_id) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'correo y role_id son requeridos.');
  if (!CORREO_REGEX.test(correo)) throw new ApiError(422, 'CORREO_INVALIDO', 'El correo no tiene un formato válido.');

  const { rows: rolRows } = await pool.query(
    'SELECT id FROM roles WHERE id = $1 AND (company_id IS NULL OR company_id = $2)',
    [role_id, req.usuario.companyId]
  );
  if (!rolRows[0]) throw new ApiError(422, 'ROL_INVALIDO', 'Ese rol no existe o no pertenece a tu empresa.');

  let temporalGenerada = null;
  const { rows: existenteRows } = await pool.query('SELECT id FROM users WHERE correo = $1', [correo]);
  let userId = existenteRows[0] && existenteRows[0].id;

  if (!userId) {
    if (!nombres || !apellidos) {
      throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombres y apellidos son requeridos para una persona nueva.');
    }
    temporalGenerada = crypto.randomBytes(9).toString('base64url'); // 12 caracteres, legible para copiar/pegar
    const hash = await bcrypt.hash(temporalGenerada, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (nombres, apellidos, correo, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [nombres, apellidos, correo, hash]
    );
    userId = rows[0].id;
  }

  const membresia = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows: yaMiembro } = await client.query('SELECT id FROM company_users WHERE user_id = $1 AND company_id = $2', [
      userId,
      req.usuario.companyId,
    ]);
    if (yaMiembro[0]) throw new ApiError(409, 'YA_ES_MIEMBRO', 'Esa persona ya pertenece a esta empresa.');

    const { rows } = await client.query(
      `INSERT INTO company_users (user_id, company_id, role_id, branch_id, unido_en)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [userId, req.usuario.companyId, role_id, branch_id || null]
    );
    await auditoria.registrar(client, {
      companyId: req.usuario.companyId,
      userId: req.usuario.id,
      accion: 'usuario.invitar',
      entidad: 'company_users',
      entidadId: rows[0].id,
      valorNuevo: { correo, role_id },
      ip: req.ip,
    });
    return rows[0];
  });

  res.status(201).json({
    membresia_id: membresia.id,
    usuario_id: userId,
    correo,
    password_temporal: temporalGenerada, // null si la persona ya existía en Qolqa
  });
}

async function cambiarRol(req, res) {
  const { role_id } = req.body;
  if (!role_id) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'role_id es requerido.');

  const { rows: rolRows } = await pool.query(
    'SELECT id FROM roles WHERE id = $1 AND (company_id IS NULL OR company_id = $2)',
    [role_id, req.usuario.companyId]
  );
  if (!rolRows[0]) throw new ApiError(422, 'ROL_INVALIDO', 'Ese rol no existe o no pertenece a tu empresa.');

  const actualizada = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('UPDATE company_users SET role_id = $1 WHERE id = $2 RETURNING *', [
      role_id,
      req.params.id,
    ]);
    if (rows[0]) {
      await auditoria.registrar(client, {
        companyId: req.usuario.companyId,
        userId: req.usuario.id,
        accion: 'usuario.cambiar_rol',
        entidad: 'company_users',
        entidadId: rows[0].id,
        valorNuevo: { role_id },
        ip: req.ip,
      });
    }
    return rows[0];
  });

  if (!actualizada) throw new ApiError(404, 'NO_ENCONTRADO', 'Esa membresía no existe en tu empresa.');
  res.json(actualizada);
}

async function cambiarEstado(req, res) {
  const { activo } = req.body;
  if (typeof activo !== 'boolean') throw new ApiError(422, 'DATOS_INCOMPLETOS', 'activo debe ser true o false.');

  const actualizada = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('UPDATE company_users SET activo = $1 WHERE id = $2 RETURNING *', [
      activo,
      req.params.id,
    ]);
    if (rows[0]) {
      await auditoria.registrar(client, {
        companyId: req.usuario.companyId,
        userId: req.usuario.id,
        accion: activo ? 'usuario.reactivar' : 'usuario.desactivar',
        entidad: 'company_users',
        entidadId: rows[0].id,
        ip: req.ip,
      });
    }
    return rows[0];
  });

  if (!actualizada) throw new ApiError(404, 'NO_ENCONTRADO', 'Esa membresía no existe en tu empresa.');
  res.json(actualizada);
}

module.exports = { listar, invitar, cambiarRol, cambiarEstado };
