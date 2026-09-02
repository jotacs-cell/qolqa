const { pool, conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');

const METODOS_PAGO = ['yape', 'plin', 'transferencia', 'efectivo'];
const PLANES = ['trial', 'emprendedor', 'negocios', 'empresarial'];
// 5 MB en base64 (~4/3 del tamaño real) — suficiente para una foto de
// pantalla de Yape/Plin o un PDF de constancia de transferencia.
const MAX_BASE64_LENGTH = 7_000_000;

// companies tiene RLS (ver schema.sql) — una consulta plana con pool.query
// nunca encuentra nada porque app.user_id/app.company_id no están fijados.
// Este proxy no actúa a nombre de un usuario real, así que usamos la MISMA
// cuenta super admin de la plataforma como contexto (companies_visible_
// superadmin ya la deja ver cualquier empresa) — es justo el mismo caso de
// uso que /api/v1/admin/*, solo que llamado por pos-backend en vez de un
// navegador.
const SUPERADMIN_USER_ID = process.env.SUPERADMIN_USER_ID;

async function empresaPorRuc(ruc) {
  if (!SUPERADMIN_USER_ID) throw new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta SUPERADMIN_USER_ID en el .env.');
  const rows = await conContexto({ userId: SUPERADMIN_USER_ID }, async (client) => {
    const { rows } = await client.query('SELECT id FROM companies WHERE ruc = $1', [ruc]);
    return rows;
  });
  if (!rows[0]) throw new ApiError(404, 'EMPRESA_NO_ENCONTRADA', 'No hay ninguna empresa registrada en Qolqa con ese RUC.');
  return rows[0].id;
}

/** Estado de suscripción de una empresa, para que su propio sistema de
 * ventas (pos-backend) le muestre a su dueño si está al día o no. */
async function obtenerSuscripcion(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const rows = await conContexto({ userId: SUPERADMIN_USER_ID }, async (client) => {
    const { rows } = await client.query(
      'SELECT plan, estado_suscripcion, suscripcion_vencimiento FROM companies WHERE id = $1',
      [companyId]
    );
    return rows;
  });
  res.json(rows[0]);
}

/** La empresa sube un comprobante declarando que ya pagó — queda
 * pendiente hasta que el super admin lo revise (ver admin.controller.js
 * aprobarComprobante/rechazarComprobante). comprobantes_pago no tiene RLS
 * (no hace falta: siempre se llega por RUC ya resuelto, nunca directo
 * desde un usuario de una empresa), así que pool.query es correcto aquí. */
async function subirComprobante(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { archivo_nombre, archivo_tipo, archivo_base64, monto_declarado, plan_declarado, metodo_pago } = req.body;

  if (!archivo_nombre || !archivo_tipo || !archivo_base64) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'archivo_nombre, archivo_tipo y archivo_base64 son requeridos.');
  }
  if (archivo_base64.length > MAX_BASE64_LENGTH) {
    throw new ApiError(413, 'ARCHIVO_MUY_GRANDE', 'El archivo no puede pesar más de 5 MB.');
  }
  const montoNum = Number(monto_declarado);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    throw new ApiError(422, 'MONTO_INVALIDO', 'monto_declarado debe ser un número mayor a 0.');
  }
  if (!PLANES.includes(plan_declarado)) {
    throw new ApiError(422, 'PLAN_INVALIDO', `plan_declarado debe ser uno de: ${PLANES.join(', ')}.`);
  }
  if (metodo_pago != null && !METODOS_PAGO.includes(metodo_pago)) {
    throw new ApiError(422, 'METODO_PAGO_INVALIDO', `metodo_pago debe ser uno de: ${METODOS_PAGO.join(', ')}.`);
  }

  const { rows } = await pool.query(
    `INSERT INTO comprobantes_pago (company_id, archivo_nombre, archivo_tipo, archivo_base64, monto_declarado, plan_declarado, metodo_pago)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, archivo_nombre, monto_declarado, plan_declarado, metodo_pago, estado, creado_en`,
    [companyId, archivo_nombre, archivo_tipo, archivo_base64, montoNum, plan_declarado, metodo_pago || null]
  );
  res.status(201).json(rows[0]);
}

/** Historial de comprobantes subidos por esta empresa (sin el archivo en
 * sí, para no mandar varios MB en una lista). */
async function listarComprobantesEmpresa(req, res) {
  const companyId = await empresaPorRuc(req.params.ruc);
  const { rows } = await pool.query(
    `SELECT id, archivo_nombre, monto_declarado, plan_declarado, metodo_pago, estado, motivo_rechazo, creado_en
       FROM comprobantes_pago WHERE company_id = $1 ORDER BY creado_en DESC`,
    [companyId]
  );
  res.json({ data: rows });
}

module.exports = { obtenerSuscripcion, subirComprobante, listarComprobantesEmpresa };
