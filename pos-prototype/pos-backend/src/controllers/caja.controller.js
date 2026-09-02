const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const kardex = require('../services/kardex.service');
const auditoria = require('../services/auditoria.service');

/**
 * Ventas en efectivo + ingresos/egresos manuales de un turno — la base
 * del arqueo. Se calcula on-demand (no se guarda hasta el cierre) para
 * que "caja actual" siempre muestre el esperado EN VIVO.
 */
async function calcularResumen(client, turno) {
  // estado_pago != 'pendiente': una venta a crédito (fiado) no metió
  // efectivo real a la caja todavía, aunque su metodo_pago diga
  // "efectivo" — recién cuenta cuando se cobra (ver ventas.controller.js
  // #marcarPagada), momento en el que ya no hay forma de saber en qué
  // turno se cobró, así que por ahora simplemente no entra al arqueo.
  const { rows: ventasRows } = await client.query(
    `SELECT COALESCE(SUM(total), 0) AS efectivo
       FROM ventas
      WHERE turno_caja_id = $1 AND metodo_pago = 'efectivo' AND estado_documento != 'anulada' AND estado_pago != 'pendiente'`,
    [turno.id]
  );
  const { rows: movRows } = await client.query(
    `SELECT tipo, COALESCE(SUM(monto), 0) AS total FROM movimientos_caja WHERE turno_caja_id = $1 GROUP BY tipo`,
    [turno.id]
  );
  const ingresos = Number((movRows.find((r) => r.tipo === 'ingreso') || {}).total || 0);
  const egresos = Number((movRows.find((r) => r.tipo === 'egreso') || {}).total || 0);
  const efectivoVentas = Number(ventasRows[0].efectivo);
  const montoEsperado = Number(turno.monto_inicial) + efectivoVentas + ingresos - egresos;

  return { efectivoVentas, ingresos, egresos, montoEsperado };
}

/** Abre un turno — a lo sumo uno por almacén a la vez (índice único en la tabla). */
async function abrir(req, res) {
  const { almacen_id, monto_inicial, notas } = req.body;
  if (monto_inicial == null || Number(monto_inicial) < 0) {
    throw new ApiError(422, 'MONTO_INVALIDO', 'monto_inicial es requerido y no puede ser negativo.');
  }

  const resultado = await conTransaccion(async (client) => {
    const almacenId = almacen_id || (await kardex.obtenerAlmacenPrincipal(client, req.usuario.companyId));

    try {
      const { rows } = await client.query(
        `INSERT INTO turnos_caja (company_id, almacen_id, usuario_apertura_id, monto_inicial, notas_apertura)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.usuario.companyId, almacenId, req.usuario.id, monto_inicial, notas || null]
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw new ApiError(409, 'TURNO_YA_ABIERTO', 'Ya hay un turno de caja abierto para este almacén.');
      }
      throw err;
    }
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'caja.abrir', entidad: 'turno_caja', entidadId: resultado.id, detalle: { monto_inicial },
  });

  res.status(201).json(resultado);
}

/** El turno abierto ahora mismo (si hay), con su resumen en vivo. */
async function actual(req, res) {
  const almacenId = req.query.almacen_id || (await kardex.obtenerAlmacenPrincipal(pool, req.usuario.companyId));
  const { rows } = await pool.query(
    `SELECT tc.*, a.nombre AS almacen_nombre, u.nombre AS usuario_apertura_nombre
       FROM turnos_caja tc
       JOIN almacenes a ON a.id = tc.almacen_id
       JOIN usuarios u ON u.id = tc.usuario_apertura_id
      WHERE tc.almacen_id = $1 AND tc.estado = 'abierto'`,
    [almacenId]
  );
  const turno = rows[0];
  if (!turno) return res.json({ abierto: false });

  const resumen = await calcularResumen(pool, turno);
  res.json({ abierto: true, turno, resumen });
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT tc.*, a.nombre AS almacen_nombre, u.nombre AS usuario_apertura_nombre, uc.nombre AS usuario_cierre_nombre
       FROM turnos_caja tc
       JOIN almacenes a ON a.id = tc.almacen_id
       JOIN usuarios u ON u.id = tc.usuario_apertura_id
       LEFT JOIN usuarios uc ON uc.id = tc.usuario_cierre_id
      WHERE tc.id = $1 AND tc.company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  const turno = rows[0];
  if (!turno) throw new ApiError(404, 'NO_ENCONTRADO', 'Turno de caja no encontrado.');

  const { rows: movimientos } = await pool.query(
    `SELECT mc.id, mc.tipo, mc.monto, mc.motivo, mc.creado_en, u.nombre AS usuario_nombre
       FROM movimientos_caja mc JOIN usuarios u ON u.id = mc.usuario_id
      WHERE mc.turno_caja_id = $1 ORDER BY mc.creado_en`,
    [turno.id]
  );
  const resumen = turno.estado === 'abierto' ? await calcularResumen(pool, turno) : null;

  res.json({ ...turno, movimientos, resumen });
}

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const { rows: data } = await pool.query(
    `SELECT tc.id, tc.estado, tc.monto_inicial, tc.monto_contado, tc.monto_esperado, tc.diferencia,
            tc.fecha_apertura, tc.fecha_cierre, a.nombre AS almacen_nombre, u.nombre AS usuario_apertura_nombre
       FROM turnos_caja tc
       JOIN almacenes a ON a.id = tc.almacen_id
       JOIN usuarios u ON u.id = tc.usuario_apertura_id
      WHERE tc.company_id = $1
      ORDER BY tc.fecha_apertura DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [req.usuario.companyId]
  );
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS total FROM turnos_caja WHERE company_id = $1', [req.usuario.companyId]);

  res.json({ data, paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) } });
}

async function movimiento(req, res) {
  const { tipo, monto, motivo } = req.body;
  if (!['ingreso', 'egreso'].includes(tipo)) throw new ApiError(422, 'TIPO_INVALIDO', 'tipo debe ser "ingreso" o "egreso".');
  if (!(Number(monto) > 0)) throw new ApiError(422, 'MONTO_INVALIDO', 'monto debe ser mayor a cero.');
  if (!motivo || !motivo.trim()) throw new ApiError(422, 'MOTIVO_REQUERIDO', 'Debes indicar el motivo del movimiento.');

  const { rows: turnoRows } = await pool.query(
    `SELECT id FROM turnos_caja WHERE id = $1 AND company_id = $2 AND estado = 'abierto'`,
    [req.params.id, req.usuario.companyId]
  );
  if (!turnoRows[0]) throw new ApiError(409, 'TURNO_NO_ABIERTO', 'Este turno de caja no está abierto.');

  const { rows } = await pool.query(
    `INSERT INTO movimientos_caja (turno_caja_id, tipo, monto, motivo, usuario_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.id, tipo, monto, motivo.trim(), req.usuario.id]
  );

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'caja.movimiento', entidad: 'turno_caja', entidadId: Number(req.params.id), detalle: { tipo, monto, motivo },
  });

  res.status(201).json(rows[0]);
}

/** Cierra el turno: calcula lo esperado y la diferencia frente a lo contado — el arqueo. */
async function cerrar(req, res) {
  const { monto_contado, notas } = req.body;
  if (monto_contado == null || Number(monto_contado) < 0) {
    throw new ApiError(422, 'MONTO_INVALIDO', 'monto_contado es requerido y no puede ser negativo.');
  }

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM turnos_caja WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [req.params.id, req.usuario.companyId]
    );
    const turno = rows[0];
    if (!turno) throw new ApiError(404, 'NO_ENCONTRADO', 'Turno de caja no encontrado.');
    if (turno.estado !== 'abierto') throw new ApiError(409, 'YA_CERRADO', 'Este turno ya está cerrado.');

    const { montoEsperado } = await calcularResumen(client, turno);
    const diferencia = Number((Number(monto_contado) - montoEsperado).toFixed(2));

    const { rows: cerrado } = await client.query(
      `UPDATE turnos_caja SET
         estado = 'cerrado', usuario_cierre_id = $1, monto_contado = $2,
         monto_esperado = $3, diferencia = $4, fecha_cierre = now(), notas_cierre = $5
       WHERE id = $6 RETURNING *`,
      [req.usuario.id, monto_contado, montoEsperado, diferencia, notas || null, turno.id]
    );
    return cerrado[0];
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'caja.cerrar', entidad: 'turno_caja', entidadId: resultado.id,
    detalle: { monto_contado, monto_esperado: resultado.monto_esperado, diferencia: resultado.diferencia },
  });

  res.json(resultado);
}

module.exports = { abrir, actual, obtener, listar, movimiento, cerrar };
