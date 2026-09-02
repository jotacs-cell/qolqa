const axios = require('axios');
const FormData = require('form-data');

const URL_BUSQUEDA = 'https://eldni.com/pe/buscar-datos-por-dni';

/**
 * Busca un DNI en eldni.com (scraping — no es una API oficial de RENIEC).
 * El propio sitio dice: "estos datos son de fuentes públicas y pueden tener
 * errores" — por eso esto SOLO debe usarse para autocompletar el nombre al
 * crear/editar un cliente, nunca como fuente de verdad. El usuario siempre
 * ve el nombre en un campo editable antes de guardar.
 *
 * El formulario de eldni.com corre sobre Laravel: exige un token CSRF y la
 * cookie de sesión de la MISMA visita (un GET sin eso da 419 Page Expired),
 * así que cada búsqueda hace su propio GET+POST — no se reutiliza sesión
 * entre llamadas.
 */
async function buscarPorDni(dni) {
  if (!/^\d{8}$/.test(dni)) {
    const err = new Error('El DNI debe tener 8 dígitos.');
    err.status = 422;
    throw err;
  }

  let getRes;
  try {
    getRes = await axios.get(URL_BUSQUEDA, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
  } catch (err) {
    const e = new Error('No se pudo conectar con el buscador de DNI.');
    e.status = 502;
    throw e;
  }

  const cookies = (getRes.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const tokenMatch = getRes.data.match(/name="_token" value="([^"]+)"/);
  if (!tokenMatch) {
    const e = new Error('El buscador de DNI cambió su formulario — hay que revisar la integración.');
    e.status = 502;
    throw e;
  }

  const form = new FormData();
  form.append('_token', tokenMatch[1]);
  form.append('dni', dni);

  let postRes;
  try {
    postRes = await axios.post(URL_BUSQUEDA, form, {
      headers: { ...form.getHeaders(), 'User-Agent': 'Mozilla/5.0', Cookie: cookies },
      timeout: 10000,
    });
  } catch (err) {
    const e = new Error('No se pudo consultar el DNI.');
    e.status = 502;
    throw e;
  }

  const html = postRes.data;
  const extraer = (id) => {
    const m = html.match(new RegExp('id="' + id + '" value="([^"]*)"'));
    return m ? m[1].trim() : '';
  };

  const nombreCompleto = extraer('completos');
  if (!nombreCompleto) return null; // no encontrado — DNI válido en formato pero sin datos

  return {
    dni,
    nombre_completo: nombreCompleto,
    nombres: extraer('nombres'),
    apellido_paterno: extraer('apellidop'),
    apellido_materno: extraer('apellidom'),
  };
}

module.exports = { buscarPorDni };
