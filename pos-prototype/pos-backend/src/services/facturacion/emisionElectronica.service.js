const nubefactAdapter = require('./adapters/nubefact.adapter');

/**
 * Único punto donde FacturasPOS decide A QUIÉN le pide que envíe un
 * comprobante a SUNAT. facturacion.service.js (y por lo tanto, más
 * arriba, ventas.service.js/notasCredito.service.js) llaman siempre a
 * emitir() de este archivo — nunca a un cliente de proveedor
 * directamente. Así, el día que se agregue un segundo proveedor (otro
 * OSE, un PSE, o un envío directo a SUNAT propio), el cambio queda
 * contenido acá: se agrega el adaptador nuevo y se ajusta
 * adaptadorPara() para elegir cuál usar por empresa — el resto del
 * sistema no se entera.
 *
 * Todo adaptador debe exponer:
 *   async emitir(comprobante, empresa, lineas, comprobanteAfectado)
 *     -> { aceptado, codigo, descripcion, enlacePdf, enlaceXml, enlaceCdr, hash }
 */
function adaptadorPara(empresa) {
  // Un solo proveedor por ahora — cuando exista un segundo, esto pasa a
  // leer una columna de configuración de la empresa (ej.
  // empresa.proveedor_electronico) en vez de ser siempre el mismo.
  return nubefactAdapter;
}

async function emitir(comprobante, empresa, lineas, comprobanteAfectado) {
  const adaptador = adaptadorPara(empresa);
  return adaptador.emitir(comprobante, empresa, lineas, comprobanteAfectado);
}

module.exports = { emitir };
