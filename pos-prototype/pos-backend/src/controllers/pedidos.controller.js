const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const ventasService = require('../services/ventas.service');
const { emitirComprobante } = require('../services/facturacion/facturacion.service');
const auditoria = require('../services/auditoria.service');
const kardex = require('../services/kardex.service');

/**
 * Fase 10: igual que en ventas.service.js — si no se indica almacén se usa
 * el principal de la empresa; si se indica, se valida que exista y esté
 * activo. El pedido reserva/descuenta stock de ESE almacén específico.
 */
async function resolverAlmacen(client, companyId, almacenIdSolicitado) {
  if (!almacenIdSolicitado) return kardex.obtenerAlmacenPrincipal(client, companyId);
  const { rows } = await client.query(
    'SELECT id FROM almacenes WHERE id = $1 AND company_id = $2 AND activo',
    [almacenIdSolicitado, companyId]
  );
  if (!rows[0]) throw new ApiError(422, 'ALMACEN_INVALIDO', 'El almacén indicado no existe o no está activo.');
  return rows[0].id;
}

function codigo(id) {
  return 'PED-' + String(id).padStart(6, '0');
}

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;

  const condiciones = [`p.company_id = $1`];
  const valores = [req.usuario.companyId];
  if (req.query.estado) {
    valores.push(req.query.estado);
    condiciones.push(`p.estado = $${valores.length}`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT p.id, p.estado, p.fecha_pedido, p.fecha_entrega, p.venta_id, p.cotizacion_id, p.almacen_id,
            cl.razon_social_o_nombre AS cliente_nombre,
            COALESCE((SELECT SUM(subtotal) FROM pedido_items pi WHERE pi.pedido_id = p.id), 0) AS total
       FROM pedidos p
       LEFT JOIN clientes cl ON cl.id = p.cliente_id
       ${where}
      ORDER BY p.creado_en DESC
      LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM pedidos p ${where}`, valores);

  res.json({
    data: data.map((p) => ({ ...p, codigo: codigo(p.id) })),
    paginacion: { page, limit, total: countRows[0].total, total_paginas: Math.ceil(countRows[0].total / limit) },
  });
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT p.*, cl.razon_social_o_nombre AS cliente_nombre
       FROM pedidos p LEFT JOIN clientes cl ON cl.id = p.cliente_id
      WHERE p.id = $1 AND p.company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  const pedido = rows[0];
  if (!pedido) throw new ApiError(404, 'NO_ENCONTRADO', 'Pedido no encontrado.');

  const { rows: items } = await pool.query(
    `SELECT pi.id, pi.producto_id, pr.nombre AS producto_nombre, pi.cantidad, pi.precio_unitario, pi.descuento_pct, pi.subtotal
       FROM pedido_items pi JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = $1 ORDER BY pi.id`,
    [pedido.id]
  );

  res.json({ ...pedido, codigo: codigo(pedido.id), items, total: items.reduce((s, i) => s + Number(i.subtotal), 0) });
}

async function calcularItems(client, companyId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, 'CARRITO_VACIO', 'El pedido debe tener al menos un ítem.');
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
    // Si el ítem ya trae precio_unitario (ej. viene de convertir una
    // cotización), se respeta ese precio congelado — igual que hace
    // cotizaciones.controller.js#calcularItems con el precio de lista.
    let precioUnitario = item.precio_unitario != null ? Number(item.precio_unitario) : null;
    const { rows } = await client.query('SELECT id, nombre, precio_venta FROM productos WHERE id = $1 AND company_id = $2', [
      item.producto_id,
      companyId,
    ]);
    const producto = rows[0];
    if (!producto) throw new ApiError(422, 'PRODUCTO_INEXISTENTE', `El producto ${item.producto_id} no existe.`);
    if (precioUnitario == null) precioUnitario = Number(producto.precio_venta);
    const subtotal = Number((precioUnitario * item.cantidad * (1 - descuento / 100)).toFixed(2));
    calculados.push({ producto_id: producto.id, cantidad: item.cantidad, precio_unitario: precioUnitario, descuento_pct: descuento, subtotal });
  }
  return calculados;
}

/**
 * Crea un pedido desde cero, o a partir de una cotización ya aceptada
 * (pasando cotizacion_id sin items) — en ese caso se copian el cliente y
 * las líneas de la cotización tal cual, con su precio ya negociado.
 */
async function crear(req, res) {
  const { cliente_id, cotizacion_id, fecha_entrega, notas, almacen_id } = req.body;
  let items = req.body.items;
  let clienteIdFinal = cliente_id;

  const resultado = await conTransaccion(async (client) => {
    const almacenId = await resolverAlmacen(client, req.usuario.companyId, almacen_id);

    if (cotizacion_id) {
      const { rows: cotRows } = await client.query(
        'SELECT id, cliente_id FROM cotizaciones WHERE id = $1 AND company_id = $2',
        [cotizacion_id, req.usuario.companyId]
      );
      if (!cotRows[0]) throw new ApiError(404, 'COTIZACION_NO_ENCONTRADA', 'La cotización de origen no existe.');
      if (!items) {
        const { rows: itemsCot } = await client.query(
          'SELECT producto_id, cantidad, precio_unitario, descuento_pct FROM cotizacion_items WHERE cotizacion_id = $1',
          [cotizacion_id]
        );
        items = itemsCot;
      }
      if (clienteIdFinal === undefined) clienteIdFinal = cotRows[0].cliente_id;
    }

    const calculados = await calcularItems(client, req.usuario.companyId, items);

    const { rows: pedRows } = await client.query(
      `INSERT INTO pedidos (company_id, usuario_id, cliente_id, cotizacion_id, fecha_entrega, notas, almacen_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, estado, fecha_pedido, fecha_entrega, almacen_id`,
      [req.usuario.companyId, req.usuario.id, clienteIdFinal || null, cotizacion_id || null, fecha_entrega || null, notas || null, almacenId]
    );
    const pedido = pedRows[0];

    for (const it of calculados) {
      await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, descuento_pct, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [pedido.id, it.producto_id, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal]
      );
    }

    return { ...pedido, items: calculados, total: calculados.reduce((s, i) => s + i.subtotal, 0) };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'pedido.crear', entidad: 'pedido', entidadId: resultado.id,
    detalle: { cotizacion_id: cotizacion_id || null },
  });

  res.status(201).json({ ...resultado, codigo: codigo(resultado.id) });
}

async function actualizar(req, res) {
  const { cliente_id, fecha_entrega, notas, items } = req.body;

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, estado FROM pedidos WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    const pedido = rows[0];
    if (!pedido) throw new ApiError(404, 'NO_ENCONTRADO', 'Pedido no encontrado.');
    if (pedido.estado !== 'borrador') {
      throw new ApiError(409, 'NO_EDITABLE', 'Solo se puede editar un pedido en estado "borrador".');
    }

    await client.query(
      `UPDATE pedidos SET cliente_id = $1, fecha_entrega = $2, notas = $3 WHERE id = $4`,
      [cliente_id || null, fecha_entrega || null, notas || null, pedido.id]
    );

    const calculados = await calcularItems(client, req.usuario.companyId, items);
    await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [pedido.id]);
    for (const it of calculados) {
      await client.query(
        `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario, descuento_pct, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [pedido.id, it.producto_id, it.cantidad, it.precio_unitario, it.descuento_pct, it.subtotal]
      );
    }

    return { id: pedido.id, items: calculados, total: calculados.reduce((s, i) => s + i.subtotal, 0) };
  });

  res.json({ ...resultado, codigo: codigo(resultado.id) });
}

/**
 * Confirmar = compromiso firme de entrega: reserva stock (producto_stock.
 * stock_reservado, en el almacén del pedido) sin descontarlo todavía.
 * Bloquea cada producto con FOR UPDATE para no reservar por encima de lo
 * realmente disponible EN ESE ALMACÉN aunque dos pedidos se confirmen al
 * mismo tiempo (Fase 10 — ver kardex.service.js#registrarReserva).
 */
async function confirmar(req, res) {
  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, estado, almacen_id FROM pedidos WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    const pedido = rows[0];
    if (!pedido) throw new ApiError(404, 'NO_ENCONTRADO', 'Pedido no encontrado.');
    if (pedido.estado !== 'borrador') {
      throw new ApiError(409, 'NO_CONFIRMABLE', 'Solo se puede confirmar un pedido en estado "borrador".');
    }

    const { rows: items } = await client.query('SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = $1', [pedido.id]);
    if (!items.length) throw new ApiError(409, 'CARRITO_VACIO', 'Este pedido no tiene ítems.');

    // Fase 10: lo reservable es lo disponible EN EL ALMACÉN del pedido, no
    // el total de la empresa — mismo razonamiento que ventas.service.js.
    for (const it of items) {
      const { rows: prodRows } = await client.query(
        'SELECT id, nombre FROM productos WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [it.producto_id, req.usuario.companyId]
      );
      const producto = prodRows[0];
      if (!producto) throw new ApiError(422, 'PRODUCTO_INEXISTENTE', `El producto ${it.producto_id} ya no existe.`);
      const disponible = await kardex.disponibleEnAlmacen(client, it.producto_id, pedido.almacen_id);
      if (disponible < it.cantidad) {
        throw new ApiError(
          409,
          'STOCK_INSUFICIENTE',
          `Stock disponible insuficiente para reservar "${producto.nombre}" en este almacén (disponible: ${disponible}, pedido: ${it.cantidad}).`,
          { producto_id: producto.id, almacen_id: pedido.almacen_id, disponible }
        );
      }
    }
    for (const it of items) {
      await kardex.registrarReserva(client, { productoId: it.producto_id, almacenId: pedido.almacen_id, delta: it.cantidad });
    }

    await client.query(`UPDATE pedidos SET estado = 'confirmado' WHERE id = $1`, [pedido.id]);
    return { id: pedido.id, estado: 'confirmado' };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'pedido.confirmar', entidad: 'pedido', entidadId: resultado.id,
  });
  res.json(resultado);
}

/** Cancela un pedido — si ya estaba "confirmado", libera la reserva de stock. */
async function cancelar(req, res) {
  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, estado, almacen_id FROM pedidos WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    const pedido = rows[0];
    if (!pedido) throw new ApiError(404, 'NO_ENCONTRADO', 'Pedido no encontrado.');
    if (!['borrador', 'confirmado'].includes(pedido.estado)) {
      throw new ApiError(409, 'NO_CANCELABLE', 'Este pedido ya fue facturado o ya está cancelado.');
    }

    if (pedido.estado === 'confirmado') {
      const { rows: items } = await client.query('SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = $1', [pedido.id]);
      for (const it of items) {
        await kardex.registrarReserva(client, { productoId: it.producto_id, almacenId: pedido.almacen_id, delta: -it.cantidad });
      }
    }

    await client.query(`UPDATE pedidos SET estado = 'cancelado' WHERE id = $1`, [pedido.id]);
    return { id: pedido.id, estado: 'cancelado' };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'pedido.cancelar', entidad: 'pedido', entidadId: resultado.id,
  });
  res.json(resultado);
}

/**
 * Facturar = "se entregó/se cobra, ahora sí es una venta". Solo desde
 * "confirmado" (con stock ya reservado). La reserva se libera ANTES de
 * llamar a registrarVenta porque esa función descuenta stock real y
 * valida disponibilidad por su cuenta — si no se libera antes, contaría
 * esta misma reserva dos veces. Si registrarVenta falla, se restaura la
 * reserva antes de propagar el error, para no perderla silenciosamente.
 */
async function facturar(req, res) {
  const { metodo_pago, tipo_comprobante } = req.body;
  if (!metodo_pago || !tipo_comprobante) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'metodo_pago y tipo_comprobante son requeridos para facturar.');
  }

  const { rows } = await pool.query(
    'SELECT id, estado, cliente_id, almacen_id FROM pedidos WHERE id = $1 AND company_id = $2',
    [req.params.id, req.usuario.companyId]
  );
  const pedido = rows[0];
  if (!pedido) throw new ApiError(404, 'NO_ENCONTRADO', 'Pedido no encontrado.');
  if (pedido.estado !== 'confirmado') {
    throw new ApiError(409, 'NO_FACTURABLE', 'Solo se puede facturar un pedido "confirmado" (con stock reservado).');
  }

  const { rows: itemsPedido } = await pool.query(
    'SELECT producto_id, cantidad, precio_unitario, descuento_pct FROM pedido_items WHERE pedido_id = $1',
    [pedido.id]
  );

  for (const it of itemsPedido) {
    await kardex.registrarReserva(pool, { productoId: it.producto_id, almacenId: pedido.almacen_id, delta: -it.cantidad });
  }

  let venta, comprobanteId;
  try {
    const items = itemsPedido.map((it) => ({
      producto_id: it.producto_id,
      cantidad: it.cantidad,
      precio_unitario: Number((Number(it.precio_unitario) * (1 - Number(it.descuento_pct) / 100)).toFixed(2)),
    }));

    ({ venta, comprobanteId } = await ventasService.registrarVenta({
      companyId: req.usuario.companyId,
      usuarioId: req.usuario.id,
      clienteId: pedido.cliente_id,
      metodoPago: metodo_pago,
      items,
      tipoComprobante: tipo_comprobante,
      almacenId: pedido.almacen_id,
    }));
  } catch (err) {
    for (const it of itemsPedido) {
      await kardex.registrarReserva(pool, { productoId: it.producto_id, almacenId: pedido.almacen_id, delta: it.cantidad });
    }
    throw err;
  }

  const resultadoEnvio = comprobanteId
    ? await emitirComprobante(comprobanteId)
    : { estado: 'no_aplica', descripcion: 'Recibo interno — no se envía a SUNAT.' };

  await pool.query(`UPDATE pedidos SET estado = 'facturado', venta_id = $1 WHERE id = $2`, [venta.id, pedido.id]);

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'pedido.facturar', entidad: 'pedido', entidadId: pedido.id,
    detalle: { venta_id: venta.id, comprobanteId },
  });

  res.json({ pedido: { id: pedido.id, estado: 'facturado' }, venta, comprobante: { id: comprobanteId, ...resultadoEnvio } });
}

module.exports = { listar, obtener, crear, actualizar, confirmar, cancelar, facturar };
