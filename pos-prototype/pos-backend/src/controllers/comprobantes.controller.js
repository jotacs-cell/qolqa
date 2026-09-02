const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { emitirComprobante, obtenerDatosDocumento } = require('../services/facturacion/facturacion.service');
const { generarPdfComprobante, generarTicketComprobante } = require('../services/facturacion/pdf.builder');
const { emitirNotaCredito } = require('../services/notasCredito.service');
const auditoria = require('../services/auditoria.service');

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT id, venta_id, tipo_comprobante, serie, correlativo,
            cliente_tipo_documento, cliente_numero_documento, cliente_razon_social, cliente_direccion,
            moneda, operacion_gravada, igv, total,
            estado_sunat, codigo_respuesta_sunat, descripcion_respuesta,
            hash_cpe, enlace_pdf_nubefact, enlace_xml_nubefact, enlace_cdr_nubefact,
            intentos_envio, enviado_en, respondido_en, creado_en
       FROM comprobantes_electronicos WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Comprobante no encontrado.');
  res.json(rows[0]);
}

/**
 * El XML UBL 2.1 ya no se genera ni se guarda localmente — lo arma y aloja
 * NubeFacT (ver nubefactClient.js). Este endpoint simplemente redirige al
 * enlace que NubeFacT devolvió cuando aceptó el comprobante.
 */
async function descargarXml(req, res) {
  const { rows } = await pool.query(
    'SELECT enlace_xml_nubefact FROM comprobantes_electronicos WHERE id = $1 AND company_id = $2',
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0] || !rows[0].enlace_xml_nubefact) {
    throw new ApiError(404, 'XML_NO_DISPONIBLE', 'Este comprobante todavía no tiene un XML de NubeFacT (no fue enviado o no fue aceptado).');
  }
  res.redirect(302, rows[0].enlace_xml_nubefact);
}

/**
 * Representación impresa (PDF) del comprobante — la "boleta"/"factura"/
 * "recibo" que se le entrega al cliente.
 *
 * Si NubeFacT ya aceptó este comprobante, el PDF OFICIAL (el que de verdad
 * vale ante SUNAT, con su QR y hash reales) es el que aloja NubeFacT en
 * `enlace_pdf_nubefact` — igual que ya hace descargarXml/descargarCdr, hay
 * que redirigir ahí, no generar el nuestro. Nuestro PDF (generarPdfComprobante)
 * es solo la representación de respaldo para cuando todavía no hay uno
 * oficial (pendiente de envío, error de envío, o NubeFacT sin configurar).
 */
async function descargarPdf(req, res) {
  const { comprobante, empresa, lineas, comprobanteAfectado } = await obtenerDatosDocumento(
    Number(req.params.id),
    req.usuario.companyId
  );

  if (comprobante.enlace_pdf_nubefact) {
    return res.redirect(302, comprobante.enlace_pdf_nubefact);
  }

  const pdfBuffer = await generarPdfComprobante(comprobante, empresa, lineas, comprobanteAfectado);

  const nombreArchivo = `${comprobante.tipo_comprobante}-${comprobante.serie}-${comprobante.correlativo}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  res.send(pdfBuffer);
}

/** Mismo documento que descargarPdf, en formato angosto de ticket térmico
 * (80mm) — para la impresora de mostrador en vez de una A4. */
async function descargarTicket(req, res) {
  const { comprobante, empresa, lineas } = await obtenerDatosDocumento(Number(req.params.id), req.usuario.companyId);
  const anchoMm = req.query.ancho === '58' ? 58 : 80;
  const pdfBuffer = await generarTicketComprobante(comprobante, empresa, lineas, anchoMm);

  const nombreArchivo = `ticket-${comprobante.tipo_comprobante}-${comprobante.serie}-${comprobante.correlativo}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${nombreArchivo}"`);
  res.send(pdfBuffer);
}

/** Igual que descargarXml: el CDR lo emite SUNAT pero lo aloja NubeFacT. */
async function descargarCdr(req, res) {
  const { rows } = await pool.query(
    'SELECT enlace_cdr_nubefact FROM comprobantes_electronicos WHERE id = $1 AND company_id = $2',
    [req.params.id, req.usuario.companyId]
  );
  if (!rows[0] || !rows[0].enlace_cdr_nubefact) {
    throw new ApiError(404, 'CDR_NO_DISPONIBLE', 'Todavía no hay una respuesta (CDR) de SUNAT para este comprobante.');
  }
  res.redirect(302, rows[0].enlace_cdr_nubefact);
}

async function reenviar(req, res) {
  const { rows } = await pool.query(
    'SELECT id, estado_sunat FROM comprobantes_electronicos WHERE id = $1 AND company_id = $2',
    [req.params.id, req.usuario.companyId]
  );
  const comprobante = rows[0];
  if (!comprobante) throw new ApiError(404, 'NO_ENCONTRADO', 'Comprobante no encontrado.');
  if (comprobante.estado_sunat === 'aceptado' || comprobante.estado_sunat === 'aceptado_con_observaciones') {
    throw new ApiError(409, 'YA_ACEPTADO', 'Este comprobante ya fue aceptado por SUNAT, no hace falta reenviarlo.');
  }

  const resultado = await emitirComprobante(comprobante.id);
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'comprobante.reenviar',
    entidad: 'comprobante',
    entidadId: comprobante.id,
  });
  res.json({ id: comprobante.id, ...resultado });
}

/**
 * Nota de crédito PARCIAL (o total explícita): descuentos, devolución de
 * algunos ítems, corrección de datos, etc. `codigo_motivo` es el
 * catálogo 09 de SUNAT (ver catalogosSunat.js).
 */
async function crearNotaCredito(req, res) {
  const { codigo_motivo, motivo_detalle, items } = req.body;

  const { notaId } = await emitirNotaCredito({
    companyId: req.usuario.companyId,
    comprobanteAfectadoId: Number(req.params.id),
    codigoMotivo: codigo_motivo,
    motivoDetalle: motivo_detalle,
    items,
    usuarioId: req.usuario.id,
  });

  const resultadoEnvio = await emitirComprobante(notaId);
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'comprobante.emitir_nota_credito',
    entidad: 'comprobante',
    entidadId: Number(req.params.id),
    detalle: { notaId, codigo_motivo, motivo_detalle },
  });
  res.status(201).json({ id: notaId, ...resultadoEnvio });
}

/**
 * Cancela por completo una factura o boleta ya aceptada: es un atajo
 * sobre crearNotaCredito con codigo_motivo = '01' (Anulación de la
 * operación) cubriendo TODAS las líneas — el equivalente a lo que en
 * el mostrador se pide como "anular esta factura".
 */
async function anularComprobante(req, res) {
  const { motivo } = req.body;
  if (!motivo) throw new ApiError(422, 'MOTIVO_REQUERIDO', 'Debes indicar el motivo de la anulación.');

  const { notaId, anulaVentaCompleta } = await emitirNotaCredito({
    companyId: req.usuario.companyId,
    comprobanteAfectadoId: Number(req.params.id),
    codigoMotivo: '01',
    motivoDetalle: motivo,
    items: undefined, // undefined = cubre todas las líneas
    usuarioId: req.usuario.id,
  });

  const resultadoEnvio = await emitirComprobante(notaId);
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'comprobante.anular',
    entidad: 'comprobante',
    entidadId: Number(req.params.id),
    detalle: { notaId, motivo },
  });
  res.status(201).json({ notaCreditoId: notaId, ventaAnulada: anulaVentaCompleta, ...resultadoEnvio });
}

async function listarNotasCredito(req, res) {
  const { rows } = await pool.query(
    `SELECT id, serie, correlativo, codigo_motivo, motivo_detalle, total, estado_sunat, creado_en
       FROM comprobantes_electronicos
      WHERE comprobante_afectado_id = $1 AND company_id = $2
      ORDER BY creado_en DESC`,
    [req.params.id, req.usuario.companyId]
  );
  res.json(rows);
}

module.exports = {
  obtener,
  descargarXml,
  descargarCdr,
  descargarPdf,
  descargarTicket,
  reenviar,
  crearNotaCredito,
  anularComprobante,
  listarNotasCredito,
};
