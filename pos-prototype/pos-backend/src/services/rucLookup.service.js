const axios = require('axios');

const URL_BUSQUEDA = 'https://api.decolecta.com/v1/sunat/ruc';

/**
 * Busca un RUC en la API de SUNAT vía apis.net.pe / Decolecta (no es
 * scraping: es una API con token propio). El buscador oficial de SUNAT
 * (e-consultaruc.sunat.gob.pe) genera su token de búsqueda con reCAPTCHA v3
 * invisible — automatizarlo sería un bypass de captcha, así que se usa este
 * proveedor en su lugar.
 *
 * Igual que con el DNI, el nombre/razón social encontrado siempre queda en
 * un campo editable al crear el cliente — nunca se guarda solo.
 */
async function buscarPorRuc(ruc) {
  if (!/^\d{11}$/.test(ruc)) {
    const err = new Error('El RUC debe tener 11 dígitos.');
    err.status = 422;
    throw err;
  }
  if (!process.env.DECOLECTA_TOKEN) {
    const err = new Error('La búsqueda de RUC no está configurada — falta DECOLECTA_TOKEN.');
    err.status = 503;
    throw err;
  }

  let res;
  try {
    res = await axios.get(URL_BUSQUEDA, {
      params: { numero: ruc },
      headers: { Authorization: `Bearer ${process.env.DECOLECTA_TOKEN}` },
      timeout: 10000,
      validateStatus: (status) => status === 200 || status === 422,
    });
  } catch (err) {
    const e = new Error('No se pudo consultar el RUC.');
    e.status = 502;
    throw e;
  }

  if (res.status === 422 || !res.data || !res.data.numero_documento) return null; // RUC válido en formato pero sin datos

  return {
    ruc,
    razon_social: res.data.razon_social,
    estado: res.data.estado,
    condicion: res.data.condicion,
    direccion: (res.data.direccion || '').trim(),
  };
}

module.exports = { buscarPorRuc };
