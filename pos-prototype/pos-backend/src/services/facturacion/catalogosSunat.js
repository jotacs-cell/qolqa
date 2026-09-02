// Catálogos SUNAT usados por los builders de XML UBL 2.1 (factura/boleta
// y notas de crédito/débito). Centralizados aquí para no duplicarlos.

// Catálogo 01 — tipo de documento (comprobante)
const CODIGO_TIPO_COMPROBANTE = { factura: '01', boleta: '03', nota_credito: '07', nota_debito: '08' };

// Catálogo 06 — tipo de documento de identidad del receptor
const CODIGO_TIPO_DOCUMENTO_CLIENTE = {
  sin_documento: '0',
  dni: '1',
  ce: '4',
  ruc: '6',
  pasaporte: '7',
};

// Catálogo 09 — motivo de la nota de crédito
const MOTIVOS_NOTA_CREDITO = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '03': 'Corrección por error en la descripción',
  '04': 'Descuento global',
  '05': 'Descuento por ítem',
  '06': 'Devolución total',
  '07': 'Devolución por ítem',
  '08': 'Bonificación',
  '09': 'Disminución en el valor',
  '10': 'Otros conceptos',
  '11': 'Ajustes de operaciones de exportación',
  '12': 'Ajustes afectos al IVAP',
};

// Motivos que implican que el(los) producto(s) físicamente regresan al
// negocio: disparan la reposición de stock. Los motivos de descuento,
// bonificación o corrección de datos (04, 05, 08, 09...) NO — el
// producto se lo quedó el cliente, solo cambia el monto o un dato.
const MOTIVOS_QUE_RESTITUYEN_STOCK = ['01', '06', '07'];

// De esos, los que además — cuando cubren el 100% de las líneas del
// comprobante original — anulan la venta completa (estado_documento
// pasa a "anulada" y el comprobante afectado queda `anulado = true`).
const MOTIVOS_ANULACION_TOTAL = ['01', '06'];

const IGV_TASA = 0.18;

function fmt(n) {
  return Number(n).toFixed(2);
}

module.exports = {
  CODIGO_TIPO_COMPROBANTE,
  CODIGO_TIPO_DOCUMENTO_CLIENTE,
  MOTIVOS_NOTA_CREDITO,
  MOTIVOS_QUE_RESTITUYEN_STOCK,
  MOTIVOS_ANULACION_TOTAL,
  IGV_TASA,
  fmt,
};
