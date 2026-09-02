const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

/**
 * Exportadores genéricos compartidos por los 4 reportes (ventas, compras,
 * inventario, IGV) — cada reporte arma su contenido como una lista de
 * "tablas" { titulo, columnas: [{clave, encabezado}], filas: [obj...] } y
 * estas funciones lo convierten a CSV/XLSX/PDF sin conocer de dónde
 * salió el dato.
 */

function generarCsv(tablas) {
  const lineas = [];
  for (const tabla of tablas) {
    if (tabla.titulo) lineas.push(tabla.titulo);
    lineas.push(tabla.columnas.map((c) => c.encabezado).join(','));
    for (const fila of tabla.filas) {
      lineas.push(
        tabla.columnas
          .map((c) => {
            const v = fila[c.clave];
            const s = v == null ? '' : String(v);
            // Comillas dobles si el valor trae coma, comilla o salto de línea.
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(',')
      );
    }
    lineas.push('');
  }
  return '﻿' + lineas.join('\r\n'); // BOM: Excel abre UTF-8 con tildes correctamente
}

// Excel real (con nombre de hoja) no acepta : \ / ? * [ ] ni más de 31
// caracteres — los títulos de tabla vienen en español libre ("Por tipo de
// comprobante"), así que hay que limpiarlos antes de usarlos como nombre.
function nombreHojaValido(texto, usados) {
  let base = (texto || 'Hoja').replace(/[:\\/?*[\]]/g, '').trim().slice(0, 31) || 'Hoja';
  let nombre = base;
  let n = 2;
  while (usados.has(nombre.toLowerCase())) {
    nombre = base.slice(0, 28) + '-' + n;
    n += 1;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

/** Antes, las 4 tablas de un reporte (Resumen, Por tipo, Por método,
 * Detalle) quedaban todas apiladas en una sola hoja — separadas solo por
 * una fila en blanco, así que en pantallas angostas o al ordenar/filtrar
 * se veían como "un solo cuadro" gigante. Ahora cada tabla es su propia
 * hoja (pestaña), como cualquier reporte de Excel real. */
async function generarXlsx(titulo, tablas) {
  const wb = new ExcelJS.Workbook();
  const usados = new Set();
  for (const tabla of tablas) {
    const ws = wb.addWorksheet(nombreHojaValido(tabla.titulo || titulo, usados));
    tabla.columnas.forEach((c, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = c.encabezado;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDF7' } };
    });
    let fila = 2;
    for (const filaDatos of tabla.filas) {
      tabla.columnas.forEach((c, i) => {
        ws.getCell(fila, i + 1).value = filaDatos[c.clave] == null ? '' : filaDatos[c.clave];
      });
      fila += 1;
    }
    ws.columns.forEach((col) => {
      col.width = 22;
    });
  }
  return wb.xlsx.writeBuffer();
}

function generarPdf(empresaNombre, titulo, subtitulo, tablas) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(14).font('Helvetica-Bold').text(empresaNombre, { align: 'left' });
    doc.fontSize(12).text(titulo);
    if (subtitulo) doc.fontSize(9).font('Helvetica').fillColor('#666').text(subtitulo);
    doc.moveDown();

    tablas.forEach((tabla) => {
      if (doc.y > 700) doc.addPage();
      if (tabla.titulo) {
        doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#000').text(tabla.titulo);
        doc.moveDown(0.3);
      }
      const anchoTotal = 515;
      const anchoCol = anchoTotal / tabla.columnas.length;
      const y0 = doc.y;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#fff');
      doc.rect(40, y0, anchoTotal, 16).fill('#3a3557');
      tabla.columnas.forEach((c, i) => {
        doc.fillColor('#fff').text(c.encabezado, 44 + i * anchoCol, y0 + 4, { width: anchoCol - 6 });
      });
      let y = y0 + 16;
      doc.font('Helvetica').fontSize(8);
      tabla.filas.forEach((fila, idx) => {
        if (y > 770) {
          doc.addPage();
          y = 40;
        }
        if (idx % 2 === 1) doc.rect(40, y, anchoTotal, 14).fill('#f5f4f8');
        tabla.columnas.forEach((c, i) => {
          const v = fila[c.clave];
          doc.fillColor('#000').text(v == null ? '—' : String(v), 44 + i * anchoCol, y + 3, { width: anchoCol - 6, ellipsis: true });
        });
        y += 14;
      });
      doc.y = y + 14;
    });

    doc.end();
  });
}

module.exports = { generarCsv, generarXlsx, generarPdf };
