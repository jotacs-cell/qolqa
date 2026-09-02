const { pool } = require('../config/db');

/** Solo lectura — el kardex nunca se edita a mano, se arma solo con cada
 * movimiento real de stock (ver services/kardex.service.js). */
async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = (page - 1) * limit;

  const condiciones = [`k.company_id = $1`];
  const valores = [req.usuario.companyId];
  if (req.query.producto_id) {
    valores.push(req.query.producto_id);
    condiciones.push(`k.producto_id = $${valores.length}`);
  }
  if (req.query.almacen_id) {
    valores.push(req.query.almacen_id);
    condiciones.push(`k.almacen_id = $${valores.length}`);
  }
  if (req.query.tipo) {
    valores.push(req.query.tipo);
    condiciones.push(`k.tipo = $${valores.length}`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT k.id, k.producto_id, p.nombre AS producto_nombre, k.almacen_id, a.nombre AS almacen_nombre,
            k.tipo, k.cantidad, k.stock_resultante, k.motivo, k.referencia_tipo, k.referencia_id, k.creado_en,
            u.nombre AS usuario_nombre
       FROM kardex_movimientos k
       JOIN productos p ON p.id = k.producto_id
       JOIN almacenes a ON a.id = k.almacen_id
       JOIN usuarios u ON u.id = k.usuario_id
       ${where}
      ORDER BY k.creado_en DESC
      LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM kardex_movimientos k ${where}`, valores);

  res.json({ data, paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) } });
}

module.exports = { listar };
