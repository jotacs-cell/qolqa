const bcrypt = require('bcrypt');
const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

const RUC_REGEX = /^\d{11}$/;
const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_REGEX = /^[a-z0-9-]{3,80}$/;

/**
 * Alta de una empresa nueva: crea la empresa, su primer usuario (admin) y
 * sus series de comprobantes iniciales (F001, B001, FC01, BC01), todo en
 * una sola transacción. No hay concepto de "unirse a una empresa
 * existente" en este backend — cada empresa nace con su propio admin y
 * ese admin es quien invita al resto de su equipo (ver POST
 * /api/auth/usuarios), nunca comparte cuenta con otra empresa.
 */
async function crear(req, res) {
  const { ruc, razon_social, nombre_comercial, ubigeo, direccion, admin } = req.body;

  if (!ruc || !razon_social || !ubigeo || !direccion) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'ruc, razon_social, ubigeo y direccion son requeridos.');
  }
  if (!RUC_REGEX.test(ruc)) throw new ApiError(422, 'RUC_INVALIDO', 'El RUC debe tener 11 dígitos.');
  if (!admin || !admin.nombre || !admin.email || !admin.password) {
    throw new ApiError(
      422,
      'DATOS_INCOMPLETOS',
      'admin.nombre, admin.email y admin.password son requeridos — cada empresa necesita su propio primer usuario.'
    );
  }
  if (!CORREO_REGEX.test(admin.email)) throw new ApiError(422, 'CORREO_INVALIDO', 'admin.email no tiene un formato válido.');
  if (admin.password.length < 8) throw new ApiError(422, 'PASSWORD_DEBIL', 'admin.password debe tener al menos 8 caracteres.');

  const { rows: rucExistente } = await pool.query('SELECT id FROM empresas WHERE ruc = $1', [ruc]);
  if (rucExistente[0]) throw new ApiError(409, 'RUC_EN_USO', 'Ese RUC ya está registrado.');

  const { rows: correoExistente } = await pool.query('SELECT id FROM usuarios WHERE email = $1', [admin.email]);
  if (correoExistente[0]) throw new ApiError(409, 'CORREO_EN_USO', 'Ese correo ya tiene una cuenta en otra empresa.');

  const resultado = await conTransaccion(async (client) => {
    const { rows: empresaRows } = await client.query(
      `INSERT INTO empresas (ruc, razon_social, nombre_comercial, ubigeo, direccion)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, ruc, razon_social, nombre_comercial`,
      [ruc, razon_social, nombre_comercial || null, ubigeo, direccion]
    );
    const empresa = empresaRows[0];

    const passwordHash = await bcrypt.hash(admin.password, 10);
    const { rows: usuarioRows } = await client.query(
      `INSERT INTO usuarios (company_id, nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4, 'admin')
       RETURNING id, nombre, email, rol`,
      [empresa.id, admin.nombre, admin.email, passwordHash]
    );

    await client.query(
      `INSERT INTO series_comprobantes (company_id, tipo_comprobante, serie) VALUES
         ($1, 'factura', 'F001'),
         ($1, 'boleta', 'B001'),
         ($1, 'nota_credito', 'FC01'),
         ($1, 'nota_credito', 'BC01')`,
      [empresa.id]
    );

    // Toda empresa nace con un almacén — "cada usuario que contrate un
    // plan puede tener varios almacenes", pero siempre arranca con uno
    // (el principal) para que ventas/ajustes tengan dónde registrar stock
    // desde el primer momento (ver migración 005).
    await client.query(
      `INSERT INTO almacenes (company_id, nombre, es_principal) VALUES ($1, 'Almacén principal', true)`,
      [empresa.id]
    );

    return { empresa, usuario: usuarioRows[0] };
  });

  res.status(201).json(resultado);
}

/**
 * Ver la configuración del catálogo virtual propio — para que el
 * dashboard sepa qué slug/whatsapp mostrar sin tener que adivinarlo.
 */
async function obtenerCatalogo(req, res) {
  const { rows } = await pool.query(
    'SELECT catalogo_slug, catalogo_whatsapp FROM empresas WHERE id = $1',
    [req.usuario.companyId]
  );
  res.json(rows[0]);
}

/**
 * Activa/edita el catálogo virtual propio (slug + WhatsApp de pedidos).
 * Autoservicio: cada empresa configura solo el suyo — nunca se toca el
 * de otra (siempre WHERE id = companyId del token).
 */
async function actualizarCatalogo(req, res) {
  const { catalogo_slug, catalogo_whatsapp } = req.body;
  if (catalogo_slug != null && !SLUG_REGEX.test(catalogo_slug)) {
    throw new ApiError(
      422,
      'SLUG_INVALIDO',
      'El identificador del catálogo debe tener solo minúsculas, números y guiones (3 a 80 caracteres).'
    );
  }

  try {
    const { rows } = await pool.query(
      `UPDATE empresas SET
         catalogo_slug = COALESCE($1, catalogo_slug),
         catalogo_whatsapp = COALESCE($2, catalogo_whatsapp)
       WHERE id = $3
       RETURNING catalogo_slug, catalogo_whatsapp`,
      [catalogo_slug || null, catalogo_whatsapp || null, req.usuario.companyId]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new ApiError(409, 'SLUG_EN_USO', 'Ese identificador de catálogo ya lo usa otro negocio — elige otro.');
    }
    throw err;
  }
}

/** Ver el número de Yape/Plin propio de la empresa (para mostrarlo en el
 * catálogo virtual, tickets, etc.). */
async function obtenerPagos(req, res) {
  const { rows } = await pool.query(
    'SELECT yape_plin_numero FROM empresas WHERE id = $1',
    [req.usuario.companyId]
  );
  res.json(rows[0]);
}

/** Autoservicio: cada empresa configura solo el suyo. */
async function actualizarPagos(req, res) {
  const { yape_plin_numero } = req.body;
  const { rows } = await pool.query(
    'UPDATE empresas SET yape_plin_numero = COALESCE($1, yape_plin_numero) WHERE id = $2 RETURNING yape_plin_numero',
    [yape_plin_numero || null, req.usuario.companyId]
  );
  res.json(rows[0]);
}

const QOLQA_BACKEND_URL = process.env.QOLQA_BACKEND_URL;
const QOLQA_BACKEND_KEY = process.env.QOLQA_BACKEND_KEY;

/** RUC propio — es la llave que usa qolqa-backend para encontrar la
 * suscripción de esta empresa (las dos bases de datos son independientes,
 * ver notas de arquitectura). */
async function rucPropio(companyId) {
  const { rows } = await pool.query('SELECT ruc FROM empresas WHERE id = $1', [companyId]);
  return rows[0].ruc;
}

function proxyQolqaConfigurado() {
  if (!QOLQA_BACKEND_URL || !QOLQA_BACKEND_KEY) {
    throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta QOLQA_BACKEND_URL / QOLQA_BACKEND_KEY en el .env.');
  }
}

/** Plan y vencimiento de la suscripción — lo administra Super Admin
 * (otro sistema, qolqa-backend), esta empresa solo lo consulta. */
async function obtenerSuscripcion(req, res) {
  proxyQolqaConfigurado();
  const ruc = await rucPropio(req.usuario.companyId);
  const resp = await fetch(`${QOLQA_BACKEND_URL}/internal/companies/${ruc}/suscripcion`, {
    headers: { 'x-internal-key': QOLQA_BACKEND_KEY },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(resp.status, (data && data.error && data.error.codigo) || 'ERROR_QOLQA_BACKEND', (data && data.error && data.error.mensaje) || 'No se pudo consultar la suscripción.');
  }
  res.json(data);
}

/** Sube un comprobante de pago (imagen/PDF en base64) declarando que ya
 * se pagó la mensualidad — queda pendiente hasta que el super admin lo
 * revise y lo apruebe. */
async function subirComprobantePago(req, res) {
  proxyQolqaConfigurado();
  const ruc = await rucPropio(req.usuario.companyId);
  const resp = await fetch(`${QOLQA_BACKEND_URL}/internal/companies/${ruc}/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': QOLQA_BACKEND_KEY },
    body: JSON.stringify(req.body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(resp.status, (data && data.error && data.error.codigo) || 'ERROR_QOLQA_BACKEND', (data && data.error && data.error.mensaje) || 'No se pudo subir el comprobante.');
  }
  res.status(201).json(data);
}

/** Historial de comprobantes que esta empresa ya subió, con su estado
 * (pendiente/aprobado/rechazado). */
async function listarComprobantesPago(req, res) {
  proxyQolqaConfigurado();
  const ruc = await rucPropio(req.usuario.companyId);
  const resp = await fetch(`${QOLQA_BACKEND_URL}/internal/companies/${ruc}/comprobantes`, {
    headers: { 'x-internal-key': QOLQA_BACKEND_KEY },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new ApiError(resp.status, (data && data.error && data.error.codigo) || 'ERROR_QOLQA_BACKEND', (data && data.error && data.error.mensaje) || 'No se pudo obtener el historial de comprobantes.');
  }
  res.json(data);
}

/** Logo propio para el encabezado de facturas/boletas/tickets impresos
 * (ver pdf.builder.js). Se guarda como data URI directamente en la fila
 * de la empresa — no hay almacenamiento de archivos persistente en este
 * backend (ver migración 017_logo_empresa.sql). */
async function obtenerLogo(req, res) {
  const { rows } = await pool.query('SELECT logo_base64 FROM empresas WHERE id = $1', [req.usuario.companyId]);
  res.json({ logo_base64: rows[0] ? rows[0].logo_base64 : null });
}

const LOGO_REGEX = /^data:image\/(png|jpe?g);base64,[a-zA-Z0-9+/=]+$/;
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2MB decoded — de sobra para un logo, no para fotos

async function actualizarLogo(req, res) {
  const { logo_base64 } = req.body;
  // null/'' = quitar el logo (vuelve a mostrarse solo el nombre de la empresa).
  if (logo_base64 != null && logo_base64 !== '') {
    if (!LOGO_REGEX.test(logo_base64)) {
      throw new ApiError(422, 'LOGO_INVALIDO', 'El logo debe ser una imagen PNG o JPG.');
    }
    const bytesAproximados = (logo_base64.length * 3) / 4;
    if (bytesAproximados > LOGO_MAX_BYTES) {
      throw new ApiError(422, 'LOGO_MUY_PESADO', 'El logo no puede pesar más de 2MB — usa una imagen más chica.');
    }
  }
  await pool.query('UPDATE empresas SET logo_base64 = $1 WHERE id = $2', [logo_base64 || null, req.usuario.companyId]);
  res.json({ logo_base64: logo_base64 || null });
}

/** Series de comprobantes (F001, B001, etc.) con su correlativo actual —
 * ver correlativos.service.js#reservarCorrelativo, que es quien de verdad
 * las usa al emitir. Este endpoint es solo para que el admin las vea antes
 * de decidir si hace falta ajustar alguna. */
async function obtenerSeries(req, res) {
  const { rows } = await pool.query(
    `SELECT id, tipo_comprobante, serie, correlativo_actual, activa
       FROM series_comprobantes WHERE company_id = $1 ORDER BY tipo_comprobante, serie`,
    [req.usuario.companyId]
  );
  res.json({ data: rows });
}

/**
 * Ajusta manualmente el correlativo_actual de una serie — para continuar
 * la numeración de un sistema de facturación anterior sin saltos: el
 * PRÓXIMO comprobante de esa serie sale con correlativo_actual + 1 (ver
 * reservarCorrelativo). Solo ADMIN, y solo hacia ARRIBA — nunca se permite
 * bajarlo, porque eso repetiría un número que ya salió y podría terminar
 * reportando dos comprobantes distintos con el mismo correlativo a SUNAT.
 */
async function actualizarSerie(req, res) {
  if (req.usuario.rol !== 'admin') {
    throw new ApiError(403, 'SOLO_ADMIN', 'Solo un administrador puede ajustar el correlativo de una serie.');
  }
  const { correlativo_actual } = req.body;
  if (!Number.isInteger(correlativo_actual) || correlativo_actual < 0) {
    throw new ApiError(422, 'CORRELATIVO_INVALIDO', 'correlativo_actual debe ser un entero mayor o igual a 0.');
  }

  const { rows } = await pool.query(
    `UPDATE series_comprobantes SET correlativo_actual = $1
      WHERE id = $2 AND company_id = $3 AND correlativo_actual <= $1
      RETURNING id, tipo_comprobante, serie, correlativo_actual`,
    [correlativo_actual, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) {
    const { rows: existe } = await pool.query(
      'SELECT correlativo_actual FROM series_comprobantes WHERE id = $1 AND company_id = $2',
      [req.params.id, req.usuario.companyId]
    );
    if (!existe[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Serie no encontrada.');
    throw new ApiError(
      409, 'CORRELATIVO_MENOR',
      `No se puede bajar el correlativo — ya está en ${existe[0].correlativo_actual}. Bajarlo repetiría un número que ya salió.`
    );
  }

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'serie.actualizar_correlativo', entidad: 'serie_comprobante', entidadId: rows[0].id,
    detalle: { correlativo_actual },
  });
  res.json(rows[0]);
}

module.exports = {
  crear,
  obtenerCatalogo,
  actualizarCatalogo,
  obtenerPagos,
  actualizarPagos,
  obtenerSuscripcion,
  subirComprobantePago,
  listarComprobantesPago,
  obtenerLogo,
  actualizarLogo,
  obtenerSeries,
  actualizarSerie,
};
