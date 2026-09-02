const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');
const rucLookup = require('../services/rucLookup.service');

const TIPOS_VALIDOS = ['sin_documento', 'dni', 'ruc', 'ce', 'pasaporte'];

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;
  const { search } = req.query;

  const condiciones = [`company_id = $1`];
  const valores = [req.usuario.companyId];

  if (search) {
    valores.push(`%${search}%`);
    condiciones.push(`(razon_social_o_nombre ILIKE $${valores.length} OR numero_documento ILIKE $${valores.length})`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT id, tipo_documento, numero_documento, razon_social_o_nombre, direccion, telefono, email, creado_en
       FROM proveedores ${where}
      ORDER BY razon_social_o_nombre
      LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM proveedores ${where}`, valores);
  const total = countRows[0].total;

  res.json({ data, paginacion: { page, limit, total, total_paginas: Math.ceil(total / limit) } });
}

async function obtener(req, res) {
  const { rows } = await pool.query('SELECT * FROM proveedores WHERE id = $1 AND company_id = $2', [
    req.params.id,
    req.usuario.companyId,
  ]);
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Proveedor no encontrado.');
  res.json(rows[0]);
}

async function crear(req, res) {
  const {
    tipo_documento = 'sin_documento',
    numero_documento = null,
    razon_social_o_nombre,
    direccion = null,
    telefono = null,
    email = null,
  } = req.body;

  if (!razon_social_o_nombre) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'razon_social_o_nombre es requerido.');
  }
  if (!TIPOS_VALIDOS.includes(tipo_documento)) {
    throw new ApiError(422, 'TIPO_DOCUMENTO_INVALIDO', `tipo_documento debe ser uno de: ${TIPOS_VALIDOS.join(', ')}.`);
  }
  if (tipo_documento !== 'sin_documento' && !numero_documento) {
    throw new ApiError(422, 'NUMERO_DOCUMENTO_REQUERIDO', 'numero_documento es requerido cuando hay tipo_documento.');
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO proveedores (company_id, tipo_documento, numero_documento, razon_social_o_nombre, direccion, telefono, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.usuario.companyId, tipo_documento, numero_documento, razon_social_o_nombre, direccion, telefono, email]
    );
    await auditoria.registrar({
      companyId: req.usuario.companyId,
      usuarioId: req.usuario.id,
      accion: 'proveedor.crear',
      entidad: 'proveedor',
      entidadId: rows[0].id,
      detalle: { razon_social_o_nombre, numero_documento },
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'DOCUMENTO_DUPLICADO', 'Ya existe un proveedor con ese número de documento.');
    throw err;
  }
}

async function actualizar(req, res) {
  const { razon_social_o_nombre, direccion, telefono, email } = req.body;
  const { rows } = await pool.query(
    `UPDATE proveedores SET
       razon_social_o_nombre = COALESCE($1, razon_social_o_nombre),
       direccion = COALESCE($2, direccion),
       telefono = COALESCE($3, telefono),
       email = COALESCE($4, email)
     WHERE id = $5 AND company_id = $6
     RETURNING *`,
    [razon_social_o_nombre, direccion, telefono, email, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Proveedor no encontrado.');
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'proveedor.actualizar',
    entidad: 'proveedor',
    entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

async function eliminar(req, res) {
  const { rows } = await pool.query(
    'DELETE FROM proveedores WHERE id = $1 AND company_id = $2 RETURNING id, razon_social_o_nombre',
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Proveedor no encontrado.');
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'proveedor.eliminar',
    entidad: 'proveedor',
    entidadId: rows[0].id,
    detalle: { razon_social_o_nombre: rows[0].razon_social_o_nombre },
  });
  res.status(204).send();
}

/** Mismo buscador de RUC (apis.net.pe/Decolecta) que ya usan los clientes. */
async function buscarRuc(req, res) {
  const resultado = await rucLookup.buscarPorRuc(req.params.numero);
  if (!resultado) {
    return res.json({ encontrado: false });
  }
  res.json({ encontrado: true, ...resultado });
}

module.exports = { listar, obtener, crear, actualizar, eliminar, buscarRuc };
