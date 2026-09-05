const { conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { reservarCorrelativo } = require('./correlativos.service');
const kardex = require('./kardex.service');
const {
  MOTIVOS_NOTA_CREDITO,
  MOTIVOS_QUE_RESTITUYEN_STOCK,
  MOTIVOS_ANULACION_TOTAL,
  IGV_TASA,
} = require('./facturacion/catalogosSunat');

/**
 * Emite una nota de crédito sobre una factura o boleta YA ACEPTADA por
 * SUNAT. Es el único mecanismo legal para "cancelar" o corregir un
 * comprobante aceptado — nunca se edita ni se borra.
 *
 * - Sin `items`: nota de crédito TOTAL — cubre todas las líneas del
 *   comprobante original (esto es lo que usa PATCH /api/comprobantes/:id/anular
 *   para cancelar una factura/boleta completa).
 * - Con `items`: nota de crédito PARCIAL — devolución o descuento de
 *   solo algunos productos/cantidades.
 *
 * Repone stock únicamente para los motivos que implican que el producto
 * físicamente regresa (anulación, devolución) — un descuento o una
 * corrección de RUC no repone nada. Si el motivo es de anulación/
 * devolución TOTAL y cubre el 100% de las líneas, además marca la venta
 * original como "anulada" y el comprobante afectado como `anulado`.
 *
 * Igual que con las ventas, esta función SOLO deja todo listo en la
 * base de datos (reserva correlativo, calcula montos, repone stock). El
 * envío a SUNAT ocurre después, fuera de la transacción — ver
 * controllers/comprobantes.controller.js.
 */
async function emitirNotaCredito({ companyId, comprobanteAfectadoId, codigoMotivo, motivoDetalle, items, usuarioId }) {
  if (!MOTIVOS_NOTA_CREDITO[codigoMotivo]) {
    throw new ApiError(
      422,
      'MOTIVO_INVALIDO',
      `codigoMotivo debe ser uno del catálogo 09 de SUNAT: ${Object.keys(MOTIVOS_NOTA_CREDITO).join(', ')}.`
    );
  }
  if (!motivoDetalle || !motivoDetalle.trim()) {
    throw new ApiError(422, 'MOTIVO_DETALLE_REQUERIDO', 'Debes describir el motivo de la nota de crédito.');
  }

  return conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM comprobantes_electronicos WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [comprobanteAfectadoId, companyId]
    );
    const original = rows[0];
    if (!original) throw new ApiError(404, 'NO_ENCONTRADO', 'El comprobante afectado no existe.');
    if (!['factura', 'boleta'].includes(original.tipo_comprobante)) {
      throw new ApiError(422, 'TIPO_INVALIDO', 'Solo se puede emitir una nota de crédito sobre una factura o boleta.');
    }
    if (!['aceptado', 'aceptado_con_observaciones'].includes(original.estado_sunat)) {
      throw new ApiError(
        409,
        'COMPROBANTE_NO_ACEPTADO',
        'Solo se puede emitir una nota de crédito sobre un comprobante ya aceptado por SUNAT. ' +
          'Si todavía no fue aceptado, usa PATCH /api/ventas/:id/anular en su lugar.'
      );
    }
    if (original.anulado) {
      throw new ApiError(409, 'YA_ANULADO', 'Este comprobante ya fue anulado con una nota de crédito anterior.');
    }

    const { rows: lineasOriginales } = await client.query(
      // unidad_medida/unidad_nombre salen de detalle_ventas (congeladas al
      // vender), no del producto en vivo — una nota de crédito sobre una
      // línea vendida por unidad mayor (caja) debe reportar esa misma
      // unidad, no la unidad suelta del producto hoy.
      `SELECT dv.producto_id, dv.cantidad, dv.precio_unitario_historico, dv.subtotal,
              dv.unidad_nombre, dv.unidad_medida_codigo AS unidad_medida,
              p.codigo_barras, p.nombre, p.codigo_afectacion_igv
         FROM detalle_ventas dv JOIN productos p ON p.id = dv.producto_id
        WHERE dv.venta_id = $1
        ORDER BY dv.id`,
      [original.venta_id]
    );

    // Cuánto ya se acreditó en notas anteriores (para no acreditar dos veces la misma unidad)
    const { rows: notasPrevias } = await client.query(
      "SELECT lineas_nota FROM comprobantes_electronicos WHERE comprobante_afectado_id = $1 AND estado_sunat NOT IN ('rechazado')",
      [original.id]
    );
    const yaAcreditado = {}; // producto_id -> cantidad
    for (const n of notasPrevias) {
      for (const l of n.lineas_nota || []) {
        yaAcreditado[l.producto_id] = (yaAcreditado[l.producto_id] || 0) + l.cantidad;
      }
    }

    let lineasNota;
    if (!items || items.length === 0) {
      lineasNota = lineasOriginales.map((l) => {
        const disponible = l.cantidad - (yaAcreditado[l.producto_id] || 0);
        if (disponible <= 0) {
          throw new ApiError(409, 'SIN_SALDO_POR_ACREDITAR', `El producto ${l.producto_id} ya fue acreditado en su totalidad.`);
        }
        return { ...l, cantidad: disponible, subtotal: Number((l.precio_unitario_historico * disponible).toFixed(2)) };
      });
    } else {
      lineasNota = items.map((item) => {
        const orig = lineasOriginales.find((l) => l.producto_id === item.producto_id);
        if (!orig) throw new ApiError(422, 'ITEM_NO_PERTENECE', `El producto ${item.producto_id} no está en este comprobante.`);
        const disponible = orig.cantidad - (yaAcreditado[item.producto_id] || 0);
        if (!Number.isInteger(item.cantidad) || item.cantidad <= 0 || item.cantidad > disponible) {
          throw new ApiError(
            422, 'CANTIDAD_INVALIDA',
            `Cantidad inválida para el producto ${item.producto_id} (disponible para acreditar: ${disponible}).`
          );
        }
        return { ...orig, cantidad: item.cantidad, subtotal: Number((orig.precio_unitario_historico * item.cantidad).toFixed(2)) };
      });
    }

    const cubreTodo = lineasOriginales.every((lo) => {
      const acreditadoAhora = (yaAcreditado[lo.producto_id] || 0) + (lineasNota.find((ln) => ln.producto_id === lo.producto_id)?.cantidad || 0);
      return acreditadoAhora >= lo.cantidad;
    });

    // Gravada/IGV se acumulan LÍNEA POR LÍNEA (mismo criterio que
    // ventas.service.js y nubefactClient.js) para que la suma de las
    // líneas siempre cuadre exacto con el total del documento — ver
    // ventas.service.js para el detalle de por qué recalcular desde el
    // total (total/1.18) puede descuadrar un céntimo.
    const total = Number(lineasNota.reduce((s, l) => s + Number(l.subtotal), 0).toFixed(2));
    let gravada = 0;
    let igv = 0;
    for (const l of lineasNota) {
      const gravadaLinea = Number((Number(l.subtotal) / (1 + IGV_TASA)).toFixed(2));
      gravada += gravadaLinea;
      igv += Number((Number(l.subtotal) - gravadaLinea).toFixed(2));
    }
    gravada = Number(gravada.toFixed(2));
    igv = Number(igv.toFixed(2));

    const serieForzada = original.tipo_comprobante === 'factura' ? 'FC01' : 'BC01';
    const { serie, correlativo } = await reservarCorrelativo(client, companyId, 'nota_credito', serieForzada);

    const lineasNotaJson = lineasNota.map((l) => ({
      producto_id: l.producto_id,
      codigo_barras: l.codigo_barras,
      nombre: l.nombre,
      unidad_medida: l.unidad_medida,
      unidad_nombre: l.unidad_nombre,
      codigo_afectacion_igv: l.codigo_afectacion_igv,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario_historico,
      subtotal: l.subtotal,
    }));

    const { rows: notaRows } = await client.query(
      `INSERT INTO comprobantes_electronicos
         (company_id, venta_id, tipo_comprobante, serie, correlativo, comprobante_afectado_id,
          codigo_motivo, motivo_detalle, lineas_nota,
          cliente_tipo_documento, cliente_numero_documento, cliente_razon_social, cliente_direccion,
          operacion_gravada, igv, total, estado_sunat)
       VALUES ($1,$2,'nota_credito',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pendiente')
       RETURNING id`,
      [
        companyId, original.venta_id, serie, correlativo, original.id,
        codigoMotivo, motivoDetalle.trim(), JSON.stringify(lineasNotaJson),
        original.cliente_tipo_documento, original.cliente_numero_documento, original.cliente_razon_social, original.cliente_direccion,
        gravada, igv, total,
      ]
    );
    const notaId = notaRows[0].id;

    if (MOTIVOS_QUE_RESTITUYEN_STOCK.includes(codigoMotivo)) {
      const almacenId = await kardex.obtenerAlmacenPrincipal(client, companyId);
      for (const l of lineasNota) {
        await kardex.registrarMovimiento(client, {
          companyId, productoId: l.producto_id, almacenId, tipo: 'entrada', cantidad: l.cantidad,
          motivo: 'Nota de crédito', referenciaTipo: 'nota_credito', referenciaId: notaId, usuarioId,
        });
      }
    }

    const anulaVentaCompleta = MOTIVOS_ANULACION_TOTAL.includes(codigoMotivo) && cubreTodo;
    if (anulaVentaCompleta) {
      await client.query('UPDATE comprobantes_electronicos SET anulado = TRUE WHERE id = $1', [original.id]);
      await client.query("UPDATE ventas SET estado_documento = 'anulada' WHERE id = $1", [original.venta_id]);
    }

    return { notaId, total, cubreTodo, anulaVentaCompleta };
  });
}

module.exports = { emitirNotaCredito };
