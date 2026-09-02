// Convierte un monto (p.ej. 125.50) a su representación legal en letras,
// tal como la exige SUNAT en el <cbc:Note> del comprobante:
// "SON CIENTO VEINTICINCO CON 50/100 SOLES"

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const DECENAS = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const DIEZ_Y_TANTOS = ['VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS_MAYORES = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function seccionATexto(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';

  let texto = '';
  const c = Math.floor(n / 100);
  const resto = n % 100;

  if (c > 0) texto += CENTENAS[c] + ' ';

  if (resto >= 20) {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (resto >= 20 && resto <= 29) texto += DIEZ_Y_TANTOS[u];
    else texto += DECENAS_MAYORES[d] + (u > 0 ? ' Y ' + UNIDADES[u] : '');
  } else if (resto >= 10) {
    texto += DECENAS[resto - 10];
  } else if (resto > 0) {
    texto += UNIDADES[resto];
  }

  return texto.trim();
}

function enteroATexto(n) {
  if (n === 0) return 'CERO';

  const millones = Math.floor(n / 1000000);
  const miles = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;

  let partes = [];
  if (millones > 0) partes.push(millones === 1 ? 'UN MILLON' : `${seccionATexto(millones)} MILLONES`);
  if (miles > 0) partes.push(miles === 1 ? 'MIL' : `${seccionATexto(miles)} MIL`);
  if (resto > 0) partes.push(seccionATexto(resto));

  return partes.join(' ').trim();
}

/** @param {number} monto  @param {string} moneda 'PEN' | 'USD' */
function montoALetras(monto, moneda = 'PEN') {
  const nombreMoneda = moneda === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES';
  const entero = Math.floor(monto);
  const centimos = Math.round((monto - entero) * 100);
  const centimosTexto = String(centimos).padStart(2, '0');

  return `SON: ${enteroATexto(entero)} CON ${centimosTexto}/100 ${nombreMoneda}`;
}

module.exports = { montoALetras };
