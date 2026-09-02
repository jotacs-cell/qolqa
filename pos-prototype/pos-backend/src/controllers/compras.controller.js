const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const comprasService = require('../services/compras.service');
const kardex = require('../services/kardex.service');
const auditoria = require('../services/auditoria.service');

async function crear(req, res) {
  const { proveedor_id, numero_factura_proveedor, items } = req.body;

  const { compra } = await comprasService.registrarCompra({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    proveedorId: proveedor_id,
    numeroFacturaProveedor: numero_factura_proveedor,
    items,
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'compra.crear',
    entidad: 'compra',
    entidadId: compra.id,
    detalle: { proveedor_id, total: compra.total },
  });

  res.status(201).json(compra);
}

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const condiciones = [`c.company_id = $1`];
  const valores = [req.usuario.companyId];
  if (req.query.estado_pago) {
    valores.push(req.query.estado_pago);
    condiciones.push(`c.estado_pago = $${valores.length}`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT c.id, c.fecha, c.total, c.numero_factura_proveedor, c.estado_pago, c.estado_documento,
            p.razon_social_o_nombre AS proveedor_nombre
       FROM compras c
       LEFT JOIN proveedores p ON p.id = c.proveedor_id
       ${where}
      ORDER BY c.fecha DESC
      LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM compras c ${where}`, valores);

  res.json({ data, paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) } });
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT c.*, p.razon_social_o_nombre AS proveedor_nombre
       FROM compras c LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.id = $1 AND c.company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  const compra = rows[0];
  if (!compra) throw new ApiError(404, 'NO_ENCONTRADO', 'Compra no encontrada.');

  const { rows: items } = await pool.query(
    `SELECT dc.producto_id, p.nombre, dc.cantidad, dc.precio_unitario_historico, dc.subtotal
       FROM detalle_compras dc JOIN productos p ON p.id = dc.producto_id
      WHERE dc.compra_id = $1 ORDER BY dc.id`,
    [compra.id]
  );

  res.json({ ...compra, items });
}

/** Anula una compra: la mercadería sale de nuevo (se devuelve al proveedor). */
async function anular(req, res) {
  const { motivo } = req.body;
  if (!motivo) throw new ApiError(422, 'MOTIVO_REQUERIDO', 'Debes indicar el motivo de la anulación.');

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, estado_documento FROM compras WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    const compra = rows[0];
    if (!compra) throw new ApiError(404, 'NO_ENCONTRADO', 'Compra no encontrada.');
    if (compra.estado_documento === 'anulada') {
      throw new ApiError(409, 'YA_ANULADA', 'Esta compra ya estaba anulada.');
    }

    await client.query("UPDATE compras SET estado_documento = 'anulada' WHERE id = $1", [compra.id]);

    const { rows: lineas } = await client.query(
      'SELECT producto_id, cantidad FROM detalle_compras WHERE compra_id = $1',
      [compra.id]
    );
    const almacenId = await kardex.obtenerAlmacenPrincipal(client, req.usuario.companyId);
    for (const linea of lineas) {
      await kardex.registrarMovimiento(client, {
        companyId: req.usuario.companyId, productoId: linea.producto_id, almacenId, tipo: 'salida', cantidad: linea.cantidad,
        motivo: 'Compra anulada — devolución a proveedor', referenciaTipo: 'compra_anulada', referenciaId: compra.id, usuarioId: req.usuario.id,
      });
    }

    return { id: compra.id, estado_documento: 'anulada', motivo };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'compra.anular', entidad: 'compra', entidadId: resultado.id, detalle: { motivo },
  });

  res.json(resultado);
}

async function marcarPagada(req, res) {
  const { rows } = await pool.query(
    `UPDATE compras SET estado_pago = 'pagada' WHERE id = $1 AND company_id = $2 AND estado_documento != 'anulada' RETURNING id, estado_pago`,
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Compra no encontrada o ya anulada.');
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'compra.marcar_pagada', entidad: 'compra', entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

module.exports = { crear, listar, obtener, anular, marcarPagada };
