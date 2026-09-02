const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const comprasService = require('../services/compras.service');
const auditoria = require('../services/auditoria.service');

function codigo(id) {
  return 'OC-' + String(id).padStart(6, '0');
}

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const condiciones = [`oc.company_id = $1`];
  const valores = [req.usuario.companyId];
  if (req.query.estado) {
    valores.push(req.query.estado);
    condiciones.push(`oc.estado = $${valores.length}`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT oc.id, oc.estado, oc.fecha_orden, oc.fecha_entrega_esperada, oc.compra_id,
            p.razon_social_o_nombre AS proveedor_nombre,
            COALESCE((SELECT SUM(subtotal) FROM orden_compra_items oci WHERE oci.orden_compra_id = oc.id), 0) AS total
       FROM ordenes_compra oc
       LEFT JOIN proveedores p ON p.id = oc.proveedor_id
       ${where}
      ORDER BY oc.creado_en DESC
      LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM ordenes_compra oc ${where}`, valores);

  res.json({
    data: data.map((o) => ({ ...o, codigo: codigo(o.id) })),
    paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) },
  });
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT oc.*, p.razon_social_o_nombre AS proveedor_nombre
       FROM ordenes_compra oc LEFT JOIN proveedores p ON p.id = oc.proveedor_id
      WHERE oc.id = $1 AND oc.company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  const orden = rows[0];
  if (!orden) throw new ApiError(404, 'NO_ENCONTRADA', 'Orden de compra no encontrada.');

  const { rows: items } = await pool.query(
    `SELECT oci.id, oci.producto_id, p.nombre AS producto_nombre, oci.cantidad, oci.precio_unitario, oci.subtotal
       FROM orden_compra_items oci JOIN productos p ON p.id = oci.producto_id
      WHERE oci.orden_compra_id = $1 ORDER BY oci.id`,
    [orden.id]
  );

  res.json({ ...orden, codigo: codigo(orden.id), items, total: items.reduce((s, i) => s + Number(i.subtotal), 0) });
}

async function calcularItems(client, companyId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, 'CARRITO_VACIO', 'La orden de compra debe tener al menos un ítem.');
  }
  const calculados = [];
  for (const item of items) {
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      throw new ApiError(422, 'CANTIDAD_INVALIDA', `Cantidad inválida para el producto ${item.producto_id}.`);
    }
    if (!(Number(item.precio_unitario) >= 0)) {
      throw new ApiError(422, 'PRECIO_INVALIDO', `precio_unitario inválido para el producto ${item.producto_id}.`);
    }
    const { rows } = await client.query('SELECT id, nombre FROM productos WHERE id = $1 AND company_id = $2', [
      item.producto_id,
      companyId,
    ]);
    const producto = rows[0];
    if (!producto) throw new ApiError(422, 'PRODUCTO_INEXISTENTE', `El producto ${item.producto_id} no existe.`);
    const precioUnitario = Number(item.precio_unitario);
    const subtotal = Number((precioUnitario * item.cantidad).toFixed(2));
    calculados.push({ producto_id: producto.id, cantidad: item.cantidad, precio_unitario: precioUnitario, subtotal });
  }
  return calculados;
}

async function crear(req, res) {
  const { proveedor_id, fecha_entrega_esperada, notas, items } = req.body;

  const resultado = await conTransaccion(async (client) => {
    const calculados = await calcularItems(client, req.usuario.companyId, items);

    const { rows: ocRows } = await client.query(
      `INSERT INTO ordenes_compra (company_id, usuario_id, proveedor_id, fecha_entrega_esperada, notas)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, estado, fecha_orden, fecha_entrega_esperada`,
      [req.usuario.companyId, req.usuario.id, proveedor_id || null, fecha_entrega_esperada || null, notas || null]
    );
    const orden = ocRows[0];

    for (const it of calculados) {
      await client.query(
        `INSERT INTO orden_compra_items (orden_compra_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [orden.id, it.producto_id, it.cantidad, it.precio_unitario, it.subtotal]
      );
    }

    return { ...orden, items: calculados, total: calculados.reduce((s, i) => s + i.subtotal, 0) };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'orden_compra.crear', entidad: 'orden_compra', entidadId: resultado.id,
  });

  res.status(201).json({ ...resultado, codigo: codigo(resultado.id) });
}

async function actualizar(req, res) {
  const { proveedor_id, fecha_entrega_esperada, notas, items } = req.body;

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, estado FROM ordenes_compra WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    const orden = rows[0];
    if (!orden) throw new ApiError(404, 'NO_ENCONTRADA', 'Orden de compra no encontrada.');
    if (orden.estado !== 'borrador') {
      throw new ApiError(409, 'NO_EDITABLE', 'Solo se puede editar una orden de compra en estado "borrador".');
    }

    await client.query(
      `UPDATE ordenes_compra SET proveedor_id = $1, fecha_entrega_esperada = $2, notas = $3 WHERE id = $4`,
      [proveedor_id || null, fecha_entrega_esperada || null, notas || null, orden.id]
    );

    const calculados = await calcularItems(client, req.usuario.companyId, items);
    await client.query('DELETE FROM orden_compra_items WHERE orden_compra_id = $1', [orden.id]);
    for (const it of calculados) {
      await client.query(
        `INSERT INTO orden_compra_items (orden_compra_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [orden.id, it.producto_id, it.cantidad, it.precio_unitario, it.subtotal]
      );
    }

    return { id: orden.id, items: calculados, total: calculados.reduce((s, i) => s + i.subtotal, 0) };
  });

  res.json({ ...resultado, codigo: codigo(resultado.id) });
}

/** Confirmar = se le envió la orden al proveedor — todavía no llega mercadería. */
async function confirmar(req, res) {
  const { rows } = await pool.query(
    `UPDATE ordenes_compra SET estado = 'confirmada'
      WHERE id = $1 AND company_id = $2 AND estado = 'borrador'
      RETURNING id, estado`,
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(409, 'NO_DISPONIBLE', 'Solo se puede confirmar una orden en estado "borrador".');
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'orden_compra.confirmar', entidad: 'orden_compra', entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

async function cancelar(req, res) {
  const { rows } = await pool.query(
    `UPDATE ordenes_compra SET estado = 'cancelada'
      WHERE id = $1 AND company_id = $2 AND estado IN ('borrador','confirmada')
      RETURNING id, estado`,
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(409, 'NO_DISPONIBLE', 'Esta orden ya no se puede cancelar.');
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'orden_compra.cancelar', entidad: 'orden_compra', entidadId: rows[0].id,
  });
  res.json(rows[0]);
}

/**
 * Recibir = la mercadería llegó de verdad — reutiliza compras.service.js
 * con las MISMAS líneas de la orden (mismo precio ya negociado), igual
 * que cotizaciones.controller.js#confirmar reutiliza registrarVenta.
 */
async function recibir(req, res) {
  const { numero_factura_proveedor } = req.body;

  const { rows } = await pool.query(
    'SELECT id, estado, proveedor_id FROM ordenes_compra WHERE id = $1 AND company_id = $2',
    [req.params.id, req.usuario.companyId]
  );
  const orden = rows[0];
  if (!orden) throw new ApiError(404, 'NO_ENCONTRADA', 'Orden de compra no encontrada.');
  if (orden.estado !== 'confirmada') {
    throw new ApiError(409, 'NO_RECIBIBLE', 'Solo se puede recibir una orden en estado "confirmada".');
  }

  const { rows: itemsOrden } = await pool.query(
    'SELECT producto_id, cantidad, precio_unitario FROM orden_compra_items WHERE orden_compra_id = $1',
    [orden.id]
  );
  const items = itemsOrden.map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad, precio_unitario: it.precio_unitario }));

  const { compra } = await comprasService.registrarCompra({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    proveedorId: orden.proveedor_id,
    numeroFacturaProveedor: numero_factura_proveedor,
    items,
  });

  await pool.query(`UPDATE ordenes_compra SET estado = 'recibida', compra_id = $1 WHERE id = $2`, [compra.id, orden.id]);

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'orden_compra.recibir', entidad: 'orden_compra', entidadId: orden.id, detalle: { compra_id: compra.id },
  });

  res.json({ orden: { id: orden.id, estado: 'recibida' }, compra });
}

module.exports = { listar, obtener, crear, actualizar, confirmar, cancelar, recibir };
