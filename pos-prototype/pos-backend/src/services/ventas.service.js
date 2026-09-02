const { conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { reservarCorrelativo } = require('./correlativos.service');
const kardex = require('./kardex.service');

const IGV = 0.18;

/**
 * Registra una venta completa dentro de una única transacción SQL:
 *   1. bloquea y valida stock de cada producto (SELECT ... FOR UPDATE)
 *   2. inserta la cabecera en `ventas`
 *   3. inserta las líneas en `detalle_ventas` (precio congelado)
 *   4. descuenta el stock en `productos`
 *   5. reserva serie/correlativo y crea el registro en
 *      `comprobantes_electronicos` en estado "pendiente"
 * Si cualquier paso falla, PostgreSQL revierte todo (rollback automático
 * al re-lanzar el error desde dentro de conTransaccion).
 *
 * OJO: aquí NO se llama a SUNAT/OSE. Eso pasa después, fuera de esta
 * transacción — nunca se debe hacer una llamada de red mientras se
 * sostienen locks de fila en la base de datos.
 */
async function registrarVenta({ companyId, usuarioId, clienteId, metodoPago, items, tipoComprobante, esCredito, diasCredito, almacenId: almacenIdSolicitado }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, 'CARRITO_VACIO', 'La venta debe tener al menos un ítem.');
  }
  if (!['factura', 'boleta', 'recibo'].includes(tipoComprobante)) {
    throw new ApiError(422, 'TIPO_COMPROBANTE_INVALIDO', 'tipoComprobante debe ser "factura", "boleta" o "recibo".');
  }
  // Solo una venta a crédito necesita días de crédito (con qué calcular su
  // fecha_vencimiento) — al contado no aplica y se guarda NULL.
  const diasCreditoValido = esCredito ? Number(diasCredito) : null;
  if (esCredito && (!Number.isInteger(diasCreditoValido) || diasCreditoValido <= 0)) {
    throw new ApiError(422, 'DIAS_CREDITO_INVALIDO', 'Indica un número de días de crédito válido (mayor a 0).');
  }

  return conTransaccion(async (client) => {
    // Fase 10: la venta sale de un almacén concreto — si no se indica
    // cuál (la mayoría de negocios con uno solo), se usa el principal,
    // igual que antes. Si se indica, se valida que sea de esta empresa.
    let almacenId;
    if (almacenIdSolicitado) {
      const { rows: almacenRows } = await client.query(
        'SELECT id FROM almacenes WHERE id = $1 AND company_id = $2 AND activo',
        [almacenIdSolicitado, companyId]
      );
      if (!almacenRows[0]) throw new ApiError(422, 'ALMACEN_INVALIDO', 'El almacén indicado no existe o no está activo.');
      almacenId = almacenRows[0].id;
    } else {
      almacenId = await kardex.obtenerAlmacenPrincipal(client, companyId);
    }

    let total = 0;
    const lineas = [];

    for (const item of items) {
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
        throw new ApiError(422, 'CANTIDAD_INVALIDA', `Cantidad inválida para el producto ${item.producto_id}.`);
      }

      const { rows } = await client.query(
        `SELECT id, precio_venta, estado
           FROM productos WHERE id = $1 AND company_id = $2 FOR UPDATE`,
        [item.producto_id, companyId]
      );
      const producto = rows[0];
      if (!producto) {
        throw new ApiError(422, 'PRODUCTO_INEXISTENTE', `El producto ${item.producto_id} no existe.`);
      }
      if (producto.estado !== 'activo') {
        throw new ApiError(422, 'PRODUCTO_INACTIVO', `El producto ${item.producto_id} no está activo para venta.`);
      }
      // Lo vendible es lo disponible EN ESTE ALMACÉN (stock - reservado
      // ahí mismo) — no el total de la empresa: un almacén sin stock no
      // se puede vender solo porque otro almacén sí tenga (Fase 10). Lo
      // reservado por pedidos "confirmado" en este almacén tampoco se
      // puede vender por otro lado — facturar el pedido dueño de esa
      // reserva ya la libera antes de llegar aquí.
      const disponible = await kardex.disponibleEnAlmacen(client, item.producto_id, almacenId);
      if (disponible < item.cantidad) {
        throw new ApiError(
          409,
          'STOCK_INSUFICIENTE',
          `Stock insuficiente para el producto ${item.producto_id} en este almacén.`,
          { producto_id: item.producto_id, almacen_id: almacenId, stock_disponible: disponible }
        );
      }

      // Si el ítem trae precio_unitario (ej. viene de confirmar una
      // cotización, con su descuento ya aplicado), se respeta ese precio
      // congelado en vez de recalcular al precio de lista actual — el
      // cliente aceptó la cotización a ESE precio, no al de hoy.
      const precioUnitario = item.precio_unitario != null ? Number(item.precio_unitario) : Number(producto.precio_venta);
      const subtotal = Number((precioUnitario * item.cantidad).toFixed(2));
      total += subtotal;

      lineas.push({ productoId: producto.id, cantidad: item.cantidad, precioUnitario, subtotal });
    }
    total = Number(total.toFixed(2));

    // 2. cabecera de venta
    // Si hay un turno de caja abierto para este almacén, la venta queda
    // ligada a él (turno_caja_id) — así el arqueo al cerrar puede sumar
    // exactamente las ventas de ESE turno, no por rango de fechas. Una
    // venta sin caja abierta sigue funcionando igual, solo que no entra
    // en ningún arqueo (ver caja.controller.js).
    const { rows: turnoRows } = await client.query(
      `SELECT id FROM turnos_caja WHERE almacen_id = $1 AND estado = 'abierto' LIMIT 1`,
      [almacenId]
    );
    const turnoCajaId = turnoRows[0] ? turnoRows[0].id : null;

    const { rows: ventaRows } = await client.query(
      `INSERT INTO ventas (company_id, usuario_id, cliente_id, total, metodo_pago, turno_caja_id, estado_pago, almacen_id, fecha_vencimiento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::int IS NULL THEN NULL ELSE (CURRENT_DATE + make_interval(days => $9::int))::date END)
       RETURNING id, fecha, fecha_vencimiento`,
      [companyId, usuarioId, clienteId || null, total, metodoPago, turnoCajaId, esCredito ? 'pendiente' : 'pagada', almacenId, diasCreditoValido]
    );
    const venta = ventaRows[0];

    // 3. detalle (insert por línea; con pocas líneas por venta no vale la pena un bulk insert)
    for (const linea of lineas) {
      await client.query(
        `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario_historico, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [venta.id, linea.productoId, linea.cantidad, linea.precioUnitario, linea.subtotal]
      );
      // 4. descontar stock — kardex.registrarMovimiento actualiza
      // producto_stock + productos.stock y deja el movimiento en el
      // kardex; el CHECK stock >= 0 sigue siendo la última red de
      // seguridad si algo se coló antes del chequeo del paso 1.
      await kardex.registrarMovimiento(client, {
        companyId, productoId: linea.productoId, almacenId, tipo: 'salida', cantidad: linea.cantidad,
        referenciaTipo: 'venta', referenciaId: venta.id, usuarioId,
      });
    }

    // "recibo" es un comprobante de venta INTERNO — no es un documento SUNAT
    // (no gasta serie/correlativo electrónico, nunca se envía a NubeFacT).
    // Existe para negocios/ventas que no requieren boleta o factura pero sí
    // necesitan una constancia de venta para el cliente y para caja.
    if (tipoComprobante === 'recibo') {
      return {
        venta: { id: venta.id, fecha: venta.fecha, total, metodo_pago: metodoPago, items: lineas },
        comprobanteId: null,
      };
    }

    // 5. reservar comprobante electrónico (aún no se envía a SUNAT)
    const { serie, correlativo } = await reservarCorrelativo(client, companyId, tipoComprobante);

    const operacionGravada = Number((total / (1 + IGV)).toFixed(2));
    const igv = Number((total - operacionGravada).toFixed(2));

    let clienteDatos = { tipo_documento: 'sin_documento', numero_documento: null, razon_social: 'Clientes varios', direccion: null };
    if (clienteId) {
      const { rows: clienteRows } = await client.query(
        'SELECT tipo_documento, numero_documento, razon_social_o_nombre, direccion FROM clientes WHERE id = $1 AND company_id = $2',
        [clienteId, companyId]
      );
      if (clienteRows[0]) {
        clienteDatos = {
          tipo_documento: clienteRows[0].tipo_documento,
          numero_documento: clienteRows[0].numero_documento,
          razon_social: clienteRows[0].razon_social_o_nombre,
          direccion: clienteRows[0].direccion,
        };
      }
    }
    if (tipoComprobante === 'factura' && clienteDatos.tipo_documento !== 'ruc') {
      throw new ApiError(422, 'CLIENTE_SIN_RUC', 'Para emitir factura el cliente debe tener RUC registrado.');
    }

    const { rows: comprobanteRows } = await client.query(
      `INSERT INTO comprobantes_electronicos
         (company_id, venta_id, tipo_comprobante, serie, correlativo,
          cliente_tipo_documento, cliente_numero_documento, cliente_razon_social, cliente_direccion,
          operacion_gravada, igv, total, estado_sunat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pendiente')
       RETURNING id`,
      [
        companyId, venta.id, tipoComprobante, serie, correlativo,
        clienteDatos.tipo_documento, clienteDatos.numero_documento, clienteDatos.razon_social, clienteDatos.direccion,
        operacionGravada, igv, total,
      ]
    );

    return {
      venta: { id: venta.id, fecha: venta.fecha, total, metodo_pago: metodoPago, items: lineas },
      comprobanteId: comprobanteRows[0].id,
    };
  });
}

module.exports = { registrarVenta };
