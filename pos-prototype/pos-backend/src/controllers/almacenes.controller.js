const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT a.id, a.nombre, a.direccion, a.es_principal, a.activo, a.creado_en,
            COALESCE((SELECT SUM(stock) FROM producto_stock ps WHERE ps.almacen_id = a.id), 0)::int AS stock_total
       FROM almacenes a WHERE a.company_id = $1 ORDER BY a.es_principal DESC, a.nombre`,
    [req.usuario.companyId]
  );
  res.json({ data: rows });
}

async function crear(req, res) {
  const { nombre, direccion } = req.body;
  if (!nombre) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre es requerido.');

  const { rows } = await pool.query(
    `INSERT INTO almacenes (company_id, nombre, direccion) VALUES ($1, $2, $3) RETURNING *`,
    [req.usuario.companyId, nombre, direccion || null]
  );
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'almacen.crear', entidad: 'almacen', entidadId: rows[0].id, detalle: { nombre },
  });
  res.status(201).json(rows[0]);
}

async function actualizar(req, res) {
  const { nombre, direccion, activo } = req.body;
  const { rows } = await pool.query(
    `UPDATE almacenes SET
       nombre = COALESCE($1, nombre),
       direccion = COALESCE($2, direccion),
       activo = COALESCE($3, activo)
     WHERE id = $4 AND company_id = $5
     RETURNING *`,
    [nombre, direccion, activo, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Almacén no encontrado.');
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'almacen.actualizar', entidad: 'almacen', entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

/** Marca este almacén como el principal de la empresa — desmarca cualquier otro. */
async function marcarPrincipal(req, res) {
  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM almacenes WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Almacén no encontrado.');

    // Dos pasos (desmarcar todos, marcar uno) para nunca violar el índice
    // único "un solo principal por empresa" a mitad de camino.
    await client.query('UPDATE almacenes SET es_principal = false WHERE company_id = $1', [req.usuario.companyId]);
    await client.query('UPDATE almacenes SET es_principal = true WHERE id = $1', [rows[0].id]);
    return { id: rows[0].id };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'almacen.marcar_principal', entidad: 'almacen', entidadId: resultado.id,
  });
  res.json({ ...resultado, es_principal: true });
}

module.exports = { listar, crear, actualizar, marcarPrincipal };
