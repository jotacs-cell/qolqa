const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const ventasService = require('../services/ventas.service');
const { emitirComprobante } = require('../services/facturacion/facturacion.service');
const { tienePermiso } = require('../config/permisos');
const auditoria = require('../services/auditoria.service');

function codigo(id) {
  return 'COT-' + String(id).padStart(6, '0');
}

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const condiciones = [`co.company_id = $1`];
  const valores = [req.usuario.companyId];
  if (req.query.estado) {
    valores.push(req.query.estado);
    condiciones.push(`co.estado = $${valores.length}`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT co.id, co.estado, co.fecha_cotizacion, co.fecha_vencimiento, co.venta_id,
            cl.razon_social_o_nombre AS cliente_nombre,
            COALESCE((SELECT SUM(subtotal) FROM cotizacion_items ci WHERE ci.cotizacion_id = co.id), 0) AS total
       FROM cotizaciones co
       LEFT JOIN clientes cl ON cl.id = co.cliente_id
       ${where}
      ORDER BY co.creado_en DESC
      LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM cotizaciones co ${where}`, valores);

  res.json({
    data: data.map((c) => ({ ...c, codigo: codigo(c.id) })),
    paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) },
  });
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT co.*, cl.razon_social_o_nombre AS cliente_nombre
       FROM cotizaciones co LEFT JOIN clientes cl ON cl.id = co.cliente_id
      WHERE co.id = $1 AND co.company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  const cotizacion = rows[0];
  if (!cotizacion) throw new ApiError(404, 'NO_ENCONTRADA', 'Cotización no encontrada.');

  const { rows: items } = await pool.query(
    `SELECT ci.id, ci.producto_id, p.nombre AS producto_nombre, ci.cantidad, ci.precio_unitario, ci.descuento_pct, ci.subtotal
       FROM cotizacion_items ci JOIN productos p ON p.id = ci.producto_id
      WHERE ci.cotizacion_id = $1 ORDER BY ci.id`,
    [cotizacion.id]
  );

  res.json({ ...cotizacion, codigo: codigo(cotizacion.id), items, total: items.reduce((s, i) => s + Number(i.subtotal), 0) });
}

async function calcularItems(client, companyId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, 'CARRITO_VACIO', 'La cotización debe tener al menos un ítem.');
  }
  const calculados = [];
  for (const item of items) {
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      throw new ApiError(422, 'CANTIDAD_INVALIDA', `Cantidad inválida para el producto ${item.producto_id}.`);
    }
    const descuento = Number(item.descuento_pct) || 0;
    if (descuento < 0 || descuento > 100) {
      throw new ApiError(422, 'DESCUENTO_INVALIDO', 'descuento_pct debe estar entre 0 y 100.');
    }
    const { rows } = await client.query('SELECT id, nombre, precio_venta FROM productos WHERE id = $1 AND company_id = $2', [
      item.producto_id,
      companyId,
    ]);
    const producto = rows[0];
    if (!producto) throw new ApiError(422, 'PRODUCTO_INEXISTENTE', `El producto ${item.producto_id} no existe.`);
    const precioUnitario = Number(producto.precio_venta);
    const subtotal = Number((precioUnitario * item.cantidad * (1 - descuento / 100)).toFixed(2));
    calculados.push({ producto_id: producto.id, cantidad: item.cantidad, precio_unitario: precioUnitario, descuento_pct: descuento, subtotal });
  }
  return calculados;
}

async function crear(req, res) {
  const { cliente_id, fecha_vencimiento, notas, items } = req.body;

  const resultado = await conTransaccion(async (client) => {
    const calculados = await calcularItems(client, req.usuario.companyId, items);

    const { rows: cotRows } = await client.query(
      `INSERT INTO cotizaciones (company_id, usuario_id, cliente_id, fecha_vencimiento, notas)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, estado, fecha_cotizacion, fecha_vencimiento`,
      [req.usuario.companyId, req.usuario.id, cliente_id || null, fecha_vencimiento || null, notas || null]
    );
    const cotizacion = cotRows[0];

    for (const it of calculados) {
      await client.query(
        `INSERT INTO cotizacion_items (cotizacion_id, producto_id, cantidad, precio_unitario, descuento_pct, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cotizacion.id, it.producto_id, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal]
      );
    }

    return { ...cotizacion, items: calculados, total: calculados.reduce((s, i) => s + i.subtotal, 0) };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'cotizacion.crear', entidad: 'cotizacion', entidadId: resultado.id,
  });

  res.status(201).json({ ...resultado, codigo: codigo(resultado.id) });
}

async function actualizar(req, res) {
  const { cliente_id, fecha_vencimiento, notas, items } = req.body;

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, estado FROM cotizaciones WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    const cotizacion = rows[0];
    if (!cotizacion) throw new ApiError(404, 'NO_ENCONTRADA', 'Cotización no encontrada.');
    if (cotizacion.estado !== 'borrador') {
      throw new ApiError(409, 'NO_EDITABLE', 'Solo se puede editar una cotización en estado "borrador".');
    }

    await client.query(
      `UPDATE cotizaciones SET cliente_id = $1, fecha_vencimiento = $2, notas = $3 WHERE id = $4`,
      [cliente_id || null, fecha_vencimiento || null, notas || null, cotizacion.id]
    );

    const calculados = await calcularItems(client, req.usuario.companyId, items);
    await client.query('DELETE FROM cotizacion_items WHERE cotizacion_id = $1', [cotizacion.id]);
    for (const it of calculados) {
      await client.query(
        `INSERT INTO cotizacion_items (cotizacion_id, producto_id, cantidad, precio_unitario, descuento_pct, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cotizacion.id, it.producto_id, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal]
      );
    }

    return { id: cotizacion.id, items: calculados, total: calculados.reduce((s, i) => s + i.subtotal, 0) };
  });

  res.json({ ...resultado, codigo: codigo(resultado.id) });
}

async function enviar(req, res) {
  const { rows } = await pool.query(
    `UPDATE cotizaciones SET estado = 'enviada'
      WHERE id = $1 AND company_id = $2 AND estado = 'borrador'
      RETURNING id, estado`,
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(409, 'NO_DISPONIBLE', 'Solo se puede enviar una cotización en estado "borrador".');
  // Nota: esto solo cambia el estado — no hay envío de correo real todavía
  // (no hay proveedor de email configurado). El botón queda listo para
  // conectarse a uno cuando se defina (SendGrid, SES, etc.).
  res.json(rows[0]);
}

async function rechazar(req, res) {
  const { rows } = await pool.query(
    `UPDATE cotizaciones SET estado = 'rechazada'
      WHERE id = $1 AND company_id = $2 AND estado IN ('borrador','enviada')
      RETURNING id, estado`,
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(409, 'NO_DISPONIBLE', 'Esta cotización ya no se puede rechazar.');
  res.json(rows[0]);
}

/**
 * Confirmar = "aceptó la cotización, ahora sí es una venta". Reutiliza
 * ventas.service.js#registrarVenta con las MISMAS líneas — recién aquí se
 * descuenta stock y se reserva serie/correlativo/comprobante, nunca antes.
 * método de pago y tipo de comprobante no se piden al crear la cotización
 * (todavía no se sabe cómo va a pagar) — se piden justo en este paso.
 */
async function confirmar(req, res) {
  const { metodo_pago, tipo_comprobante, almacen_id } = req.body;
  if (!metodo_pago || !tipo_comprobante) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'metodo_pago y tipo_comprobante son requeridos para confirmar.');
  }
  // Misma regla que ventas.controller.js#crear: un cajero no puede emitir
  // facturas — confirmar una cotización con tipo_comprobante "factura" es
  // otra forma de emitir un comprobante y no debe saltarse esta restricción.
  if (tipo_comprobante === 'factura' && !tienePermiso(req.usuario.rol, 'emitirFactura')) {
    throw new ApiError(403, 'PERMISO_INSUFICIENTE', 'Tu rol no puede emitir facturas — solo boletas o recibos.');
  }

  const { rows } = await pool.query(
    'SELECT id, estado, cliente_id FROM cotizaciones WHERE id = $1 AND company_id = $2',
    [req.params.id, req.usuario.companyId]
  );
  const cotizacion = rows[0];
  if (!cotizacion) throw new ApiError(404, 'NO_ENCONTRADA', 'Cotización no encontrada.');
  if (!['borrador', 'enviada'].includes(cotizacion.estado)) {
    throw new ApiError(409, 'NO_CONFIRMABLE', 'Esta cotización ya fue confirmada o ya no está disponible.');
  }

  const { rows: itemsCotizados } = await pool.query(
    'SELECT producto_id, cantidad, precio_unitario, descuento_pct FROM cotizacion_items WHERE cotizacion_id = $1',
    [cotizacion.id]
  );
  // El precio que se cobra es el YA COTIZADO (con su descuento), no el de
  // lista actual — ver la nota en ventas.service.js#registrarVenta.
  const items = itemsCotizados.map((it) => ({
    producto_id: it.producto_id,
    cantidad: it.cantidad,
    precio_unitario: Number((Number(it.precio_unitario) * (1 - Number(it.descuento_pct) / 100)).toFixed(2)),
  }));

  const { venta, comprobanteId } = await ventasService.registrarVenta({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    clienteId: cotizacion.cliente_id,
    metodoPago: metodo_pago,
    items: items,
    tipoComprobante: tipo_comprobante,
    almacenId: almacen_id || null,
  });

  const resultadoEnvio = comprobanteId
    ? await emitirComprobante(comprobanteId)
    : { estado: 'no_aplica', descripcion: 'Recibo interno — no se envía a SUNAT.' };

  await pool.query(`UPDATE cotizaciones SET estado = 'confirmada', venta_id = $1 WHERE id = $2`, [venta.id, cotizacion.id]);

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'cotizacion.confirmar', entidad: 'cotizacion', entidadId: cotizacion.id,
    detalle: { venta_id: venta.id, comprobanteId },
  });

  res.json({ cotizacion: { id: cotizacion.id, estado: 'confirmada' }, venta, comprobante: { id: comprobanteId, ...resultadoEnvio } });
}

module.exports = { listar, obtener, crear, actualizar, enviar, rechazar, confirmar };
