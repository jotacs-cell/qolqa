const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { montoALetras } = require('./numeroALetras');
const { CODIGO_TIPO_COMPROBANTE, CODIGO_TIPO_DOCUMENTO_CLIENTE, MOTIVOS_NOTA_CREDITO } = require('./catalogosSunat');

const TITULOS = {
  factura: 'FACTURA ELECTRÓNICA',
  boleta: 'BOLETA DE VENTA ELECTRÓNICA',
  nota_credito: 'NOTA DE CRÉDITO ELECTRÓNICA',
  nota_debito: 'NOTA DE DÉBITO ELECTRÓNICA',
};

const AZUL = '#1d3557';
const GRIS = '#6c6877';
const GRIS_CLARO = '#e3e1ea';

/** Texto y color que se estampan en el PDF para que el estado ante SUNAT sea visible
 * en el papel, no solo consultable en el sistema — esto es lo que el cajero o el
 * cliente ven al imprimir. */
const ESTADO_SUNAT_TEXTO = {
  pendiente: 'PENDIENTE DE ENVÍO',
  enviado: 'ENVIADO, ESPERANDO RESPUESTA',
  aceptado: 'ACEPTADO POR SUNAT',
  aceptado_con_observaciones: 'ACEPTADO CON OBSERVACIONES',
  rechazado: 'RECHAZADO POR SUNAT',
  error_envio: 'ERROR AL ENVIAR — pendiente de reintento',
  anulado: 'ANULADO (ver nota de crédito asociada)',
};
const ESTADO_SUNAT_COLOR = {
  pendiente: '#a8681a',
  enviado: '#a8681a',
  aceptado: '#237a57',
  aceptado_con_observaciones: '#a8681a',
  rechazado: '#b03a3a',
  error_envio: '#b03a3a',
  anulado: '#6c6877',
};

/**
 * Genera la representación impresa (PDF) de un comprobante — lo que se
 * le entrega o envía al cliente. Es un documento informativo: lo único
 * con valor legal ante SUNAT es el XML firmado y su CDR, que arma y firma
 * NubeFacT (ver nubefactClient.js), no este archivo; este PDF solo lo
 * representa de forma legible, con el QR que exige la normativa de
 * comprobantes electrónicos y el estado SUNAT bien visible, para que no
 * haga falta abrir el sistema para saber si fue aceptado.
 *
 * Sirve tanto para factura/boleta como para nota de crédito — el título
 * y las referencias cambian según `comprobante.tipo_comprobante`.
 *
 * @param {object} comprobante
 * @param {object} empresa
 * @param {Array}  lineas               misma forma que usan los builders de XML
 * @param {object|null} comprobanteAfectado  solo para notas de crédito/débito
 * @returns {Promise<Buffer>}
 */
function generarPdfComprobante(comprobante, empresa, lineas, comprobanteAfectado) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const titulo = TITULOS[comprobante.tipo_comprobante] || 'COMPROBANTE ELECTRÓNICO';
      const idDocumento = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;

      // ---------- encabezado ----------
      doc.fontSize(14).fillColor(AZUL).font('Helvetica-Bold').text(empresa.razon_social, 42, 42, { width: 320 });
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
        .text(`RUC ${empresa.ruc}`, { width: 320 })
        .text(empresa.direccion, { width: 320 });

      doc.roundedRect(380, 40, 172, 62, 4).stroke(GRIS_CLARO);
      doc.fontSize(9).fillColor(AZUL).font('Helvetica-Bold')
        .text(titulo, 388, 50, { width: 156, align: 'center' });
      doc.fontSize(13).fillColor('#000000').font('Helvetica-Bold')
        .text(idDocumento, 388, 68, { width: 156, align: 'center' });
      doc.fontSize(8).fillColor(GRIS).font('Helvetica')
        .text(`RUC ${empresa.ruc}`, 388, 88, { width: 156, align: 'center' });

      doc.moveDown(3);
      let y = 120;

      // ---------- referencia (solo notas) ----------
      if (comprobanteAfectado) {
        const tipoAfectado = TITULOS[comprobanteAfectado.tipo_comprobante] || comprobanteAfectado.tipo_comprobante;
        const idAfectado = `${comprobanteAfectado.serie}-${String(comprobanteAfectado.correlativo).padStart(8, '0')}`;
        doc.rect(42, y, 510, 34).fill('#f5f3f8');
        doc.fillColor(AZUL).fontSize(8).font('Helvetica-Bold').text('DOCUMENTO QUE MODIFICA', 52, y + 6);
        doc.fillColor('#000000').fontSize(9).font('Helvetica').text(`${tipoAfectado} ${idAfectado}`, 52, y + 18);
        doc.fillColor(GRIS).fontSize(8)
          .text(`Motivo: ${comprobante.codigo_motivo} — ${MOTIVOS_NOTA_CREDITO[comprobante.codigo_motivo] || comprobante.motivo_detalle}`, 220, y + 18, { width: 320 });
        y += 44;
      }

      // ---------- datos del cliente ----------
      // La caja crece si hay dirección registrada — no todas las ventas
      // tienen cliente con dirección (ej. "Clientes varios").
      const alturaCaja = comprobante.cliente_direccion ? 68 : 56;
      doc.rect(42, y, 510, alturaCaja).stroke(GRIS_CLARO);
      const etiquetaDoc = {
        sin_documento: 'Sin documento', dni: 'DNI', ce: 'Carné Ext.', ruc: 'RUC', pasaporte: 'Pasaporte',
      }[comprobante.cliente_tipo_documento] || '—';

      doc.fontSize(8).fillColor(GRIS).font('Helvetica-Bold').text('CLIENTE', 52, y + 8);
      doc.fontSize(10).fillColor('#000000').font('Helvetica').text(comprobante.cliente_razon_social, 52, y + 20, { width: 300 });
      doc.fontSize(8).fillColor(GRIS).text(`${etiquetaDoc}: ${comprobante.cliente_numero_documento || '—'}`, 52, y + 36);
      if (comprobante.cliente_direccion) {
        doc.fontSize(8).fillColor(GRIS).text(`Dirección: ${comprobante.cliente_direccion}`, 52, y + 48, { width: 300 });
      }

      const fecha = new Date(comprobante.creado_en || Date.now());
      doc.fontSize(8).fillColor(GRIS).font('Helvetica-Bold').text('FECHA DE EMISIÓN', 380, y + 8);
      doc.fontSize(10).fillColor('#000000').font('Helvetica').text(fecha.toISOString().slice(0, 10), 380, y + 20);
      doc.fontSize(8).fillColor(GRIS).text(`Moneda: ${comprobante.moneda || 'PEN'}`, 380, y + 36);

      y += alturaCaja + 16;

      // ---------- tabla de líneas ----------
      const tablaTop = y;
      const colX = { cant: 42, desc: 90, punit: 380, importe: 470 };
      doc.rect(42, y, 510, 20).fill(AZUL);
      doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
      doc.text('CANT.', colX.cant + 6, y + 6);
      doc.text('DESCRIPCIÓN', colX.desc, y + 6);
      doc.text('P. UNIT.', colX.punit, y + 6, { width: 80, align: 'right' });
      doc.text('IMPORTE', colX.importe, y + 6, { width: 74, align: 'right' });
      y += 20;

      doc.font('Helvetica').fontSize(9).fillColor('#000000');
      lineas.forEach((linea, i) => {
        const alturaFila = 18;
        if (i % 2 === 1) doc.rect(42, y, 510, alturaFila).fill('#f9f8fb');
        doc.fillColor('#000000');
        // Solo se muestra la unidad cuando NO es la unidad suelta normal
        // (ej. "3 CAJA" para una venta por unidad mayor) — para no
        // saturar el 99% de líneas que se venden sueltas.
        const unidadSufijo = linea.producto.unidad_nombre && linea.producto.unidad_nombre !== 'UNIDAD'
          ? ' ' + linea.producto.unidad_nombre
          : '';
        doc.text(String(linea.cantidad) + unidadSufijo, colX.cant + 6, y + 5, { width: colX.desc - colX.cant - 6 });
        doc.text(linea.producto.nombre, colX.desc, y + 5, { width: 280, ellipsis: true });
        doc.text(fmt(linea.precio_unitario_historico), colX.punit, y + 5, { width: 80, align: 'right' });
        doc.text(fmt(linea.subtotal), colX.importe, y + 5, { width: 74, align: 'right' });
        y += alturaFila;
      });
      doc.rect(42, tablaTop, 510, y - tablaTop).stroke(GRIS_CLARO);

      y += 10;

      // ---------- totales ----------
      const totalesX = 350;
      doc.fontSize(9).fillColor(GRIS).font('Helvetica')
        .text('Op. Gravada', totalesX, y, { width: 120, align: 'left' })
        .text(fmt(comprobante.operacion_gravada), totalesX, y, { width: 194, align: 'right' });
      y += 15;
      doc.text('IGV (18%)', totalesX, y, { width: 120 })
        .text(fmt(comprobante.igv), totalesX, y, { width: 194, align: 'right' });
      y += 18;
      doc.fontSize(11).fillColor(AZUL).font('Helvetica-Bold')
        .text('TOTAL', totalesX, y, { width: 120 })
        .text(`S/ ${fmt(comprobante.total)}`, totalesX, y, { width: 194, align: 'right' });
      y += 26;

      doc.fontSize(8).fillColor(GRIS).font('Helvetica-Oblique')
        .text(montoALetras(Number(comprobante.total), comprobante.moneda), 42, y, { width: 340 });

      // ---------- QR + pie ----------
      const qrY = y + 30;
      const qrContenido = construirContenidoQr(comprobante, empresa);
      const qrDataUrl = await QRCode.toDataURL(qrContenido, { margin: 0, width: 200 });
      doc.image(qrDataUrl, 42, qrY, { width: 70 });

      // ---------- estado SUNAT (visible en el impreso, no solo en el sistema) ----------
      // Solo se estampa cuando SUNAT ya lo aceptó — mostrarle al cliente en su
      // propio comprobante impreso un "ERROR AL ENVIAR" o "RECHAZADO" es un
      // problema interno de la empresa (ver panel de Super Admin → Alertas
      // SUNAT), no algo que el cliente final necesite leer en su boleta/factura.
      if (comprobante.estado_sunat === 'aceptado' || comprobante.estado_sunat === 'aceptado_con_observaciones') {
        const estadoTexto = ESTADO_SUNAT_TEXTO[comprobante.estado_sunat];
        const estadoColor = ESTADO_SUNAT_COLOR[comprobante.estado_sunat];
        doc.fontSize(8.5).fillColor(estadoColor).font('Helvetica-Bold')
          .text('ESTADO SUNAT: ' + estadoTexto, 124, qrY, { width: 428 });

        doc.fontSize(7).fillColor(GRIS).font('Helvetica')
          .text(
            'Representación impresa del comprobante electrónico. Puede consultar su validez en SUNAT ' +
              'Consulta de Validez de Comprobantes con el RUC, tipo, serie y número indicados arriba.',
            124, qrY + 18, { width: 428 }
          );
        if (comprobante.hash_cpe) {
          doc.text(`Hash: ${comprobante.hash_cpe}`, 124, qrY + 54, { width: 428 });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Formato QR exigido por SUNAT para la representación impresa (10 campos separados por "|"). */
function construirContenidoQr(comprobante, empresa) {
  const fecha = new Date(comprobante.creado_en || Date.now()).toISOString().slice(0, 10);
  const campos = [
    empresa.ruc,
    CODIGO_TIPO_COMPROBANTE[comprobante.tipo_comprobante] || '',
    comprobante.serie,
    comprobante.correlativo,
    fmt(comprobante.igv),
    fmt(comprobante.total),
    fecha,
    CODIGO_TIPO_DOCUMENTO_CLIENTE[comprobante.cliente_tipo_documento] || '0',
    comprobante.cliente_numero_documento || '',
    comprobante.hash_cpe || '',
  ];
  return campos.join('|');
}

function fmt(n) {
  return Number(n).toFixed(2);
}

/**
 * Ticket angosto (formato térmico) del mismo comprobante — para imprimir
 * en una impresora de ticket de mostrador en vez de A4. Mismos datos que
 * generarPdfComprobante, sin QR ni maquetación de columnas: todo en una
 * sola columna angosta, como un ticket real. Soporta los dos anchos de
 * rollo térmico más comunes: 80mm (por defecto) y 58mm — cualquier otro
 * valor de `anchoMm` cae al de 80mm.
 *
 * Las columnas numéricas (cantidad/precio + subtotal) usan una fuente
 * monoespaciada (Courier) con el ancho calculado en caracteres, no en
 * puntos — así el alineado con espacios funciona igual de bien en 58mm
 * que en 80mm, en vez de depender de un padEnd() fijo pensado para un
 * solo ancho.
 */
const METODO_PAGO_TEXTO = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  yape: 'Yape',
  plin: 'Plin',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

function generarTicketComprobante(comprobante, empresa, lineas, anchoMm) {
  return new Promise(async (resolve, reject) => {
    try {
      const mm = anchoMm === 58 ? 58 : 80;
      const ANCHO = Math.round(mm * 2.83465); // mm -> puntos PDF
      const margin = mm === 58 ? 9 : 12;
      const fs = mm === 58 ? 7 : 8;
      const doc = new PDFDocument({ width: ANCHO, height: 900, margin, autoFirstPage: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const titulo = TITULOS[comprobante.tipo_comprobante] || 'COMPROBANTE';
      const idDocumento = `${comprobante.serie}-${String(comprobante.correlativo).padStart(8, '0')}`;
      const ancho = ANCHO - margin * 2;

      /** Línea de dos columnas (izquierda/derecha) en fuente monoespaciada,
       * alineada con espacios cuyo ancho real se MIDE con doc.widthOfString
       * (no se estima por cantidad de caracteres) — así el monto de la
       * derecha nunca se corta, sin importar el visor de PDF que lo abra. */
      function filaMonoespaciada(izq, der, tam) {
        doc.font('Courier').fontSize(tam || fs);
        const anchoEspacio = doc.widthOfString(' ');
        const disponible = ancho - doc.widthOfString(izq) - doc.widthOfString(der);
        const espacios = Math.max(1, Math.floor(disponible / anchoEspacio));
        doc.text(izq + ' '.repeat(espacios) + der, { width: ancho, lineBreak: false });
      }

      /** Línea separadora que SIEMPRE llena el ancho exacto del ticket —
       * mide el ancho real del guion en la fuente/tamaño activos en vez de
       * usar una cantidad fija de guiones (33 para 80mm se veía bien en un
       * tamaño de letra, pero corta o se queda corta en otros). */
      function lineaSeparadora() {
        const anchoGuion = doc.widthOfString('-');
        const cantidad = Math.max(1, Math.floor(ancho / anchoGuion));
        doc.text('-'.repeat(cantidad), { width: ancho, align: 'center', lineBreak: false });
      }

      doc.font('Helvetica-Bold').fontSize(fs + 2).text(empresa.razon_social, { width: ancho, align: 'center' });
      doc.font('Helvetica').fontSize(fs)
        .text(`RUC ${empresa.ruc}`, { width: ancho, align: 'center' })
        .text(empresa.direccion || '', { width: ancho, align: 'center' });
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(fs + 1).text(titulo, { width: ancho, align: 'center' });
      doc.text(idDocumento, { width: ancho, align: 'center' });
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(fs);
      lineaSeparadora();

      const etiquetaDoc = { sin_documento: 'Sin documento', dni: 'DNI', ce: 'Carné Ext.', ruc: 'RUC', pasaporte: 'Pasaporte' }[comprobante.cliente_tipo_documento] || '—';
      doc.text(`Cliente: ${comprobante.cliente_razon_social}`, { width: ancho });
      doc.text(`${etiquetaDoc}: ${comprobante.cliente_numero_documento || '—'}`, { width: ancho });
      if (comprobante.cliente_direccion) {
        doc.text(`Dirección: ${comprobante.cliente_direccion}`, { width: ancho });
      }
      doc.text(`Fecha: ${new Date(comprobante.creado_en || Date.now()).toLocaleString('es-PE')}`, { width: ancho });
      lineaSeparadora();

      lineas.forEach((linea) => {
        const unidadSufijo = linea.producto.unidad_nombre && linea.producto.unidad_nombre !== 'UNIDAD'
          ? ' ' + linea.producto.unidad_nombre
          : '';
        doc.font('Helvetica-Bold').fontSize(fs).text(linea.producto.nombre, { width: ancho });
        filaMonoespaciada(`${linea.cantidad}${unidadSufijo} x ${fmt(linea.precio_unitario_historico)}`, fmt(linea.subtotal));
      });
      doc.font('Helvetica').fontSize(fs);
      lineaSeparadora();

      filaMonoespaciada('Op. Gravada', fmt(comprobante.operacion_gravada));
      filaMonoespaciada('IGV', fmt(comprobante.igv));
      filaMonoespaciada('TOTAL', `S/ ${fmt(comprobante.total)}`, fs + 3);
      doc.moveDown(0.3);

      doc.font('Helvetica-Oblique').fontSize(fs - 0.5).fillColor('#000000')
        .text(montoALetras(Number(comprobante.total), comprobante.moneda), { width: ancho });

      if (comprobante.metodo_pago) {
        doc.font('Helvetica').fontSize(fs)
          .text(`Forma de pago: ${METODO_PAGO_TEXTO[comprobante.metodo_pago] || comprobante.metodo_pago}`, { width: ancho });
      }
      if (comprobante.estado_pago) {
        const pagado = comprobante.estado_pago === 'pagada';
        doc.font('Helvetica-Bold').fillColor(pagado ? '#237a57' : '#a8681a')
          .text(pagado ? 'PAGO REGISTRADO' : 'PAGO PENDIENTE', { width: ancho });
      }
      doc.moveDown(0.5);

      // Igual que en el PDF A4: solo se estampa si SUNAT ya lo aceptó — un
      // "ERROR AL ENVIAR" en el ticket del cliente es un problema interno,
      // no algo que el cliente final necesite ver impreso.
      if (comprobante.estado_sunat === 'aceptado' || comprobante.estado_sunat === 'aceptado_con_observaciones') {
        doc.font('Helvetica-Bold').fontSize(fs - 0.5).fillColor(ESTADO_SUNAT_COLOR[comprobante.estado_sunat])
          .text('ESTADO SUNAT: ' + ESTADO_SUNAT_TEXTO[comprobante.estado_sunat], { width: ancho, align: 'center' });
        doc.moveDown(0.5);
      }

      // QR al final, como en cualquier boleta/factura electrónica real —
      // se imprime SIEMPRE, no solo cuando SUNAT ya respondió: el QR es el
      // estándar (RUC|tipo|serie|correlativo|IGV|total|fecha|doc cliente|
      // hash) y el último campo va vacío hasta que llegue el hash, algo
      // normal cuando el ticket se imprime en el momento de la venta.
      {
        const qrContenido = construirContenidoQr(comprobante, empresa);
        const qrDataUrl = await QRCode.toDataURL(qrContenido, { margin: 0, width: 200 });
        const qrSize = mm === 58 ? 65 : 85;
        // doc.image() con x/y explícitos NO avanza el cursor de texto solo —
        // hay que moverlo a mano o el texto de abajo queda encima del QR.
        const yQr = doc.y;
        doc.image(qrDataUrl, (ANCHO - qrSize) / 2, yQr, { width: qrSize });
        doc.y = yQr + qrSize + 4;
        doc.font('Helvetica').fontSize(fs - 1.5).fillColor(GRIS)
          .text('Representación impresa del comprobante electrónico. Consulte su validez en SUNAT.', {
            width: ancho,
            align: 'center',
          });
        doc.moveDown(0.3);
      }

      doc.fillColor('#000000').font('Helvetica').fontSize(fs - 0.5)
        .text('¡Gracias por su compra!', { width: ancho, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generarPdfComprobante, generarTicketComprobante, construirContenidoQr };
