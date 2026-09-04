const axios = require('axios');
const {
  CODIGO_TIPO_DOCUMENTO_CLIENTE,
  MOTIVOS_NOTA_CREDITO,
  AFECTACION_IGV_A_TIPO_IGV_NUBEFACT,
  CUBETA_POR_TIPO_IGV_NUBEFACT,
  fmt,
} = require('./catalogosSunat');

// ---------------------------------------------------------------------
// NubeFacT es un OSE (Operador de Servicios Electrónicos) homologado por
// SUNAT: le mandas los datos de la venta en JSON y ELLOS arman el XML
// UBL 2.1, lo firman con su propio certificado digital y lo envían a
// SUNAT — por eso este proyecto ya NO necesita generar ni firmar su
// propio XML (los builders anteriores, ubl.builder.js / notaCredito.
// builder.js / firmaDigital.js / oseClient.js / sunatDirecto.js, quedaron
// sin uso y se eliminaron). Tampoco necesitas comprar un certificado
// digital propio: NubeFacT firma con el suyo, dentro de su contrato de
// OSE contigo.
//
// ⚠️ IMPORTANTE — verifica esto antes de producción:
// Los nombres de campo de abajo (tipo_de_comprobante, sunat_transaction,
// cliente_tipo_de_documento, moneda, tipo_de_igv, etc.) están tomados de
// la documentación pública de NubeFacT (nubefact.com/integracion), pero
// su manual completo con el detalle campo-por-campo está dentro de tu
// cuenta (Integración → API → "MANUAL con archivo JSON") y no pude
// leerlo desde aquí. Antes de facturar de verdad:
//   1. Entra a tu cuenta NubeFacT → activa el modo DEMO (te dan una RUTA
//      y TOKEN de prueba que no afectan tu facturación real).
//   2. Descarga ese manual y compara cada campo de construirPayload()
//      contra un ejemplo real — sobre todo los códigos numéricos.
//   3. Cuando un envío de prueba salga aceptado, recién ahí cambia
//      NUBEFACT_RUTA/NUBEFACT_TOKEN a los de producción.
// ---------------------------------------------------------------------

// Catálogo propio de NubeFacT para tipo de comprobante (no es el mismo
// que el catálogo 01 de SUNAT que usa el resto del proyecto — por eso
// este mapeo vive aquí y no en catalogosSunat.js).
const TIPO_COMPROBANTE_NUBEFACT = {
  factura: 1,
  boleta: 2,
  nota_credito: 3,
  nota_debito: 4,
};

async function enviarComprobanteNubefact(comprobante, empresa, lineas, comprobanteAfectado) {
  const ruta = empresa.nubefact_ruta;
  const token = empresa.nubefact_token;
  if (!ruta || !token) {
    throw new Error(
      'Esta empresa todavía no tiene configuradas sus credenciales de NubeFacT — pídele al administrador de la plataforma que las configure desde el panel de Super Admin.'
    );
  }

  const payload = construirPayload(comprobante, empresa, lineas, comprobanteAfectado);

  const { data } = await axios.post(ruta, payload, {
    headers: { Authorization: `Token token="${token}"`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });

  if (data && data.errors) {
    return { aceptado: false, codigo: null, descripcion: String(data.errors), crudo: data };
  }

  return {
    aceptado: !!(data && data.aceptada_por_sunat),
    codigo: (data && (data.sunat_responsecode ?? (data.aceptada_por_sunat ? '0' : null))) ?? null,
    descripcion: (data && (data.sunat_description || data.sunat_note)) || null,
    enlacePdf: (data && data.enlace_del_pdf) || null,
    enlaceXml: (data && data.enlace_del_xml) || null,
    enlaceCdr: (data && data.enlace_del_cdr) || null,
    hash: (data && data.codigo_hash) || null,
    crudo: data,
  };
}

/** Arma el JSON que espera la API de NubeFacT a partir de un comprobante ya
 * cargado por facturacion.service.js#obtenerDatosDocumento(). */
function construirPayload(comprobante, empresa, lineas, comprobanteAfectado) {
  const esNota = comprobante.tipo_comprobante === 'nota_credito' || comprobante.tipo_comprobante === 'nota_debito';

  // Los montos de cada línea (gravada/exonerada/inafecta + su IGV) se
  // calculan UNA sola vez acá y las "cubetas" del total del documento
  // (total_gravada/total_exonerada/total_inafecta/total_igv) se arman
  // SUMANDO esos mismos valores — nunca recalculando desde
  // comprobante.total o comprobante.operacion_gravada por separado.
  // Antes se calculaban por dos caminos independientes (uno acá por
  // línea, otro ya guardado en el comprobante desde el total) y el
  // redondeo de cada uno por su lado podía descuadrar el documento un
  // céntimo respecto a la suma de sus propias líneas — justo lo que
  // SUNAT/NubeFacT rechazan en su validación estructural.
  const cubetas = { gravada: 0, exonerada: 0, inafecta: 0, igv: 0 };

  const items = lineas.map((l) => {
    const tipoIgv = AFECTACION_IGV_A_TIPO_IGV_NUBEFACT[l.producto.codigo_afectacion_igv] || 1;
    const cubeta = CUBETA_POR_TIPO_IGV_NUBEFACT[tipoIgv] || 'gravada';
    const precio = Number(l.precio_unitario_historico);
    const subtotalTotal = Number(l.subtotal);

    // Solo lo gravado lleva IGV — exonerado/inafecto reportan su valor
    // íntegro como subtotal, sin descontar nada.
    const valorUnitario = cubeta === 'gravada' ? precio / (1 + 0.18) : precio;
    const subtotalSinIgv = cubeta === 'gravada' ? Number((subtotalTotal / (1 + 0.18)).toFixed(2)) : subtotalTotal;
    const igvLinea = cubeta === 'gravada' ? Number((subtotalTotal - subtotalSinIgv).toFixed(2)) : 0;

    cubetas[cubeta] += subtotalSinIgv;
    cubetas.igv += igvLinea;

    return {
      unidad_de_medida: l.producto.unidad_medida || 'NIU',
      codigo: l.producto.codigo_barras || '',
      descripcion: l.producto.nombre,
      cantidad: Number(l.cantidad),
      valor_unitario: fmt(valorUnitario),
      precio_unitario: fmt(precio),
      descuento: '0.00',
      subtotal: fmt(subtotalSinIgv),
      tipo_de_igv: tipoIgv,
      igv: fmt(igvLinea),
      total: fmt(subtotalTotal),
      anticipo_regularizacion: false,
    };
  });

  const payload = {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: TIPO_COMPROBANTE_NUBEFACT[comprobante.tipo_comprobante],
    serie: comprobante.serie,
    numero: comprobante.correlativo,
    sunat_transaction: 1,
    cliente_tipo_de_documento: CODIGO_TIPO_DOCUMENTO_CLIENTE[comprobante.cliente_tipo_documento] != null
      ? Number(CODIGO_TIPO_DOCUMENTO_CLIENTE[comprobante.cliente_tipo_documento])
      : 0,
    cliente_numero_de_documento: comprobante.cliente_numero_documento || '',
    cliente_denominacion: comprobante.cliente_razon_social,
    cliente_direccion: '-',
    cliente_email: '',
    fecha_de_emision: formatearFecha(comprobante.creado_en),
    moneda: 1, // NubeFacT: 1 = Soles
    porcentaje_de_igv: 18.0,
    total_gravada: fmt(cubetas.gravada),
    total_igv: fmt(cubetas.igv),
    total_exonerada: fmt(cubetas.exonerada),
    total_inafecta: fmt(cubetas.inafecta),
    total_gratuita: '0.00',
    total: fmt(comprobante.total),
    observaciones: comprobante.motivo_detalle || '',
    items,
  };

  if (esNota && comprobanteAfectado) {
    payload.tipo_de_nota = comprobante.codigo_motivo;
    payload.motivo_o_sustento = MOTIVOS_NOTA_CREDITO[comprobante.codigo_motivo] || comprobante.motivo_detalle || '';
    payload.documento_que_se_modifica_tipo = TIPO_COMPROBANTE_NUBEFACT[comprobanteAfectado.tipo_comprobante];
    payload.documento_que_se_modifica_serie = comprobanteAfectado.serie;
    payload.documento_que_se_modifica_numero = comprobanteAfectado.correlativo;
  }

  return payload;
}

function formatearFecha(fecha) {
  const d = new Date(fecha || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

module.exports = { enviarComprobanteNubefact, construirPayload };
