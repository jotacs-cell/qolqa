const { pool } = require('../config/db');

/** Rango de fechas por defecto: últimos 30 días (incluye hoy). */
function rango(req) {
  const hasta = req.query.hasta || new Date().toISOString().slice(0, 10);
  const desde = req.query.desde || restarDias(hasta, 30);
  return { desde, hasta };
}

function restarDias(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Resumen del día: recaudación de hoy, N° de ventas, ticket promedio, comparación vs. ayer. */
async function resumenHoy(req, res) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(total) FILTER (WHERE fecha::date = CURRENT_DATE), 0)::float AS recaudacion_hoy,
       COUNT(*) FILTER (WHERE fecha::date = CURRENT_DATE)::int AS ventas_hoy,
       COALESCE(SUM(total) FILTER (WHERE fecha::date = CURRENT_DATE - 1), 0)::float AS recaudacion_ayer
     FROM ventas
     WHERE estado_documento = 'emitida' AND company_id = $1`,
    [req.usuario.companyId]
  );
  const r = rows[0];
  const ticketPromedio = r.ventas_hoy > 0 ? r.recaudacion_hoy / r.ventas_hoy : 0;
  const variacionPct = r.recaudacion_ayer > 0 ? ((r.recaudacion_hoy - r.recaudacion_ayer) / r.recaudacion_ayer) * 100 : null;

  res.json({
    recaudacion_hoy: round2(r.recaudacion_hoy),
    ventas_hoy: r.ventas_hoy,
    ticket_promedio: round2(ticketPromedio),
    variacion_vs_ayer_pct: variacionPct === null ? null : round2(variacionPct),
  });
}

/** Recaudación agrupada por día, para graficar una serie de tiempo. */
async function recaudacionDiaria(req, res) {
  const { desde, hasta } = rango(req);
  const { rows } = await pool.query(
    `SELECT fecha::date AS dia,
            COUNT(*)::int AS num_ventas,
            SUM(total)::float AS recaudacion
       FROM ventas
      WHERE estado_documento = 'emitida'
        AND company_id = $1
        AND fecha::date BETWEEN $2 AND $3
      GROUP BY fecha::date
      ORDER BY fecha::date`,
    [req.usuario.companyId, desde, hasta]
  );
  res.json({ desde, hasta, data: rows.map((r) => ({ ...r, recaudacion: round2(r.recaudacion) })) });
}

/** Productos de mayor rotación por cantidad vendida y por monto. */
async function productosTop(req, res) {
  const { desde, hasta } = rango(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.codigo_barras,
            SUM(dv.cantidad)::int AS unidades_vendidas,
            SUM(dv.subtotal)::float AS monto_vendido
       FROM detalle_ventas dv
       JOIN ventas v ON v.id = dv.venta_id
       JOIN productos p ON p.id = dv.producto_id
      WHERE v.estado_documento = 'emitida'
        AND v.company_id = $1
        AND v.fecha::date BETWEEN $2 AND $3
      GROUP BY p.id, p.nombre, p.codigo_barras
      ORDER BY unidades_vendidas DESC
      LIMIT $4`,
    [req.usuario.companyId, desde, hasta, limit]
  );
  res.json({ desde, hasta, data: rows.map((r) => ({ ...r, monto_vendido: round2(r.monto_vendido) })) });
}

/** Rendimiento por vendedor: cuánto y cuántas veces vendió cada cajero/usuario. */
async function rendimientoVendedores(req, res) {
  const { desde, hasta } = rango(req);
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre, u.rol,
            COUNT(v.id)::int AS num_ventas,
            SUM(v.total)::float AS monto_vendido
       FROM ventas v
       JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.estado_documento = 'emitida'
        AND v.company_id = $1
        AND v.fecha::date BETWEEN $2 AND $3
      GROUP BY u.id, u.nombre, u.rol
      ORDER BY monto_vendido DESC`,
    [req.usuario.companyId, desde, hasta]
  );
  res.json({
    desde,
    hasta,
    data: rows.map((r) => ({
      ...r,
      monto_vendido: round2(r.monto_vendido),
      ticket_promedio: round2(r.num_ventas > 0 ? r.monto_vendido / r.num_ventas : 0),
    })),
  });
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = { resumenHoy, recaudacionDiaria, productosTop, rendimientoVendedores };
