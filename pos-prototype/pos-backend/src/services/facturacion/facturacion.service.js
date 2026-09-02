const { pool } = require('../../config/db');
const { enviarComprobanteNubefact } = require('./nubefactClient');

const TIPOS_NOTA = ['nota_credito', 'nota_debito'];

/**
 * Orquesta la emisión completa de un comprobante ya creado (en estado
 * "pendiente") por ventas.service.js: le manda los datos a NubeFacT, que
 * arma el XML, lo firma con su propio certificado y lo envía a SUNAT —
 * y guarda el resultado (aceptado/rechazado + enlaces al PDF/XML/CDR que
 * NubeFacT genera y aloja).
 *
 * Se llama SIEMPRE fuera de la transacción de la venta — nunca dentro,
 * porque implica llamadas de red que no deben sostener locks de fila.
 *
 * Si algo falla (NubeFacT caído, campo mal armado, etc.) NO se revierte
 * la venta: la venta ya está confirmada y el stock ya se descontó. El
 * comprobante queda en estado "error_envio" para reintentar después
 * (ver el endpoint PATCH /api/comprobantes/:id/reenviar).
 */
async function emitirComprobante(comprobanteId) {
  const { comprobante, empresa, lineas, comprobanteAfectado } = await obtenerDatosDocumento(comprobanteId);

  try {
    await marcarComoEnviado(comprobante.id);

    const resultado = await enviarComprobanteNubefact(comprobante, empresa, lineas, comprobanteAfectado);
    const estadoFinal = mapearEstado(resultado);

    await guardarResultado(comprobante.id, {
      estado: estadoFinal,
      codigo: resultado.codigo,
      descripcion: resultado.descripcion,
      hashCpe: resultado.hash,
      enlacePdf: resultado.enlacePdf,
      enlaceXml: resultado.enlaceXml,
      enlaceCdr: resultado.enlaceCdr,
    });

    return { estado: estadoFinal, codigo: resultado.codigo, descripcion: resultado.descripcion };
  } catch (err) {
    await guardarError(comprobante.id, err.message);
    // No relanzamos: la venta ya está confirmada, esto solo queda pendiente de reintento.
    return { estado: 'error_envio', error: err.message };
  }
}

// ---------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------

/**
 * Reúne todo lo que necesita un builder (XML o PDF) para un comprobante:
 * el comprobante mismo, los datos de la empresa, sus líneas (de
 * detalle_ventas si es factura/boleta, o de lineas_nota si es una nota),
 * y — solo para notas — el comprobante que afecta.
 * Compartido por emitirComprobante() y por la generación de PDF
 * (controllers/comprobantes.controller.js).
 */
async function obtenerDatosDocumento(comprobanteId, companyId) {
  const comprobante = await cargarComprobante(comprobanteId);
  if (companyId != null && comprobante.company_id !== companyId) {
    throw new Error(`Comprobante ${comprobanteId} no existe.`);
  }
  const empresa = await cargarEmpresa(comprobante.company_id);
  const esNota = TIPOS_NOTA.includes(comprobante.tipo_comprobante);

  if (esNota) {
    const comprobanteAfectado = await cargarComprobante(comprobante.comprobante_afectado_id);
    const lineas = (comprobante.lineas_nota || []).map(normalizarLineaNota);
    return { comprobante, empresa, lineas, comprobanteAfectado };
  }

  const lineas = await cargarLineas(comprobante.venta_id);
  return { comprobante, empresa, lineas, comprobanteAfectado: null };
}

/**
 * `metodo_pago` y `estado_pago` no viven en comprobantes_electronicos (que
 * es un documento tributario, congelado al emitir) sino en la venta real
 * que lo originó — se traen con LEFT JOIN para que la representación
 * impresa (ver pdf.builder.js) pueda mostrar "Forma de pago" y "Pago
 * registrado" sin que el llamador tenga que pedirlos aparte. LEFT JOIN
 * porque una nota de crédito/débito puede no tener venta_id propio (ver
 * columna venta_id: "informativo" para notas).
 */
async function cargarComprobante(id) {
  const { rows } = await pool.query(
    `SELECT ce.*, v.metodo_pago, v.estado_pago
       FROM comprobantes_electronicos ce
       LEFT JOIN ventas v ON v.id = ce.venta_id
      WHERE ce.id = $1`,
    [id]
  );
  if (!rows[0]) throw new Error(`Comprobante ${id} no existe.`);
  return rows[0];
}

async function cargarEmpresa(companyId) {
  const { rows } = await pool.query('SELECT * FROM empresas WHERE id = $1', [companyId]);
  if (!rows[0]) {
    throw new Error(`La empresa ${companyId} no existe.`);
  }
  return rows[0];
}

async function cargarLineas(ventaId) {
  const { rows } = await pool.query(
    `SELECT dv.cantidad, dv.precio_unitario_historico, dv.subtotal,
            p.codigo_barras, p.nombre, p.unidad_medida, p.codigo_afectacion_igv
       FROM detalle_ventas dv
       JOIN productos p ON p.id = dv.producto_id
      WHERE dv.venta_id = $1
      ORDER BY dv.id`,
    [ventaId]
  );
  return rows.map((r) => ({
    cantidad: r.cantidad,
    precio_unitario_historico: r.precio_unitario_historico,
    subtotal: r.subtotal,
    producto: {
      codigo_barras: r.codigo_barras,
      nombre: r.nombre,
      unidad_medida: r.unidad_medida,
      codigo_afectacion_igv: r.codigo_afectacion_igv,
    },
  }));
}

/** Adapta una línea guardada en `lineas_nota` (JSONB) a la forma que esperan los builders de XML. */
function normalizarLineaNota(l) {
  return {
    cantidad: l.cantidad,
    precio_unitario_historico: l.precio_unitario,
    subtotal: l.subtotal,
    producto: {
      codigo_barras: l.codigo_barras,
      nombre: l.nombre,
      unidad_medida: l.unidad_medida,
      codigo_afectacion_igv: l.codigo_afectacion_igv,
    },
  };
}

// ---------------------------------------------------------------------
// Persistencia del resultado
// ---------------------------------------------------------------------
async function marcarComoEnviado(id) {
  await pool.query(
    `UPDATE comprobantes_electronicos
        SET estado_sunat = 'enviado', enviado_en = now(), intentos_envio = intentos_envio + 1
      WHERE id = $1`,
    [id]
  );
}

async function guardarResultado(id, { estado, codigo, descripcion, hashCpe, enlacePdf, enlaceXml, enlaceCdr }) {
  await pool.query(
    `UPDATE comprobantes_electronicos
        SET estado_sunat = $1, codigo_respuesta_sunat = $2, descripcion_respuesta = $3,
            hash_cpe = $4, enlace_pdf_nubefact = $5, enlace_xml_nubefact = $6, enlace_cdr_nubefact = $7,
            respondido_en = now()
      WHERE id = $8`,
    [estado, codigo, descripcion, hashCpe, enlacePdf, enlaceXml, enlaceCdr, id]
  );
}

async function guardarError(id, mensaje) {
  await pool.query(
    `UPDATE comprobantes_electronicos
        SET estado_sunat = 'error_envio', descripcion_respuesta = $1, respondido_en = now()
      WHERE id = $2`,
    [mensaje.slice(0, 500), id]
  );
}

/** NubeFacT responde `aceptado: true/false` directo — no hay un código numérico
 * que interpretar como en el envío SOAP crudo a SUNAT. */
function mapearEstado(resultado) {
  if (resultado.aceptado) return 'aceptado';
  if (resultado.codigo == null) return 'error_envio';
  return 'rechazado';
}

module.exports = { emitirComprobante, obtenerDatosDocumento };
