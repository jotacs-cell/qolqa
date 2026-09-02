const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

const ETAPAS_ACTIVAS = ['prospecto', 'contactado', 'propuesta', 'negociacion'];
const ETAPAS_VALIDAS = [...ETAPAS_ACTIVAS, 'ganada', 'perdida'];

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT o.id, o.titulo, o.etapa, o.monto_estimado, o.fecha_cierre_esperada, o.cotizacion_id, o.creado_en, o.actualizado_en,
            o.cliente_id, cl.razon_social_o_nombre AS cliente_nombre
       FROM oportunidades o JOIN clientes cl ON cl.id = o.cliente_id
      WHERE o.company_id = $1
      ORDER BY o.actualizado_en DESC`,
    [req.usuario.companyId]
  );
  res.json({ data: rows });
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT o.*, cl.razon_social_o_nombre AS cliente_nombre
       FROM oportunidades o JOIN clientes cl ON cl.id = o.cliente_id
      WHERE o.id = $1 AND o.company_id = $2`,
    [req.params.id, req.usuario.companyId]
  );
  const oportunidad = rows[0];
  if (!oportunidad) throw new ApiError(404, 'NO_ENCONTRADA', 'Oportunidad no encontrada.');

  const { rows: actividades } = await pool.query(
    `SELECT a.id, a.tipo, a.descripcion, a.creado_en, u.nombre AS usuario_nombre
       FROM oportunidad_actividades a JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.oportunidad_id = $1 ORDER BY a.creado_en DESC`,
    [oportunidad.id]
  );

  res.json({ ...oportunidad, actividades });
}

async function crear(req, res) {
  const { cliente_id, titulo, monto_estimado, fecha_cierre_esperada } = req.body;
  if (!cliente_id) throw new ApiError(422, 'CLIENTE_REQUERIDO', 'cliente_id es requerido — toda oportunidad cuelga de un cliente existente.');
  if (!titulo || !titulo.trim()) throw new ApiError(422, 'TITULO_REQUERIDO', 'Escribe un título para la oportunidad.');

  const { rows: clienteRows } = await pool.query('SELECT id FROM clientes WHERE id = $1 AND company_id = $2', [cliente_id, req.usuario.companyId]);
  if (!clienteRows[0]) throw new ApiError(404, 'CLIENTE_NO_ENCONTRADO', 'El cliente indicado no existe.');

  const { rows } = await pool.query(
    `INSERT INTO oportunidades (company_id, cliente_id, usuario_id, titulo, monto_estimado, fecha_cierre_esperada)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.usuario.companyId, cliente_id, req.usuario.id, titulo.trim(), monto_estimado || null, fecha_cierre_esperada || null]
  );
  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'oportunidad.crear', entidad: 'oportunidad', entidadId: rows[0].id, detalle: { titulo, cliente_id },
  });
  res.status(201).json(rows[0]);
}

async function actualizar(req, res) {
  const { titulo, monto_estimado, fecha_cierre_esperada } = req.body;
  const { rows } = await pool.query(
    `UPDATE oportunidades SET
       titulo = COALESCE($1, titulo),
       monto_estimado = COALESCE($2, monto_estimado),
       fecha_cierre_esperada = COALESCE($3, fecha_cierre_esperada),
       actualizado_en = now()
     WHERE id = $4 AND company_id = $5
     RETURNING *`,
    [titulo ? titulo.trim() : null, monto_estimado, fecha_cierre_esperada, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Oportunidad no encontrada.');
  res.json(rows[0]);
}

/** Mueve la oportunidad de etapa — "perdida" exige motivo (para saber POR QUÉ se perdió, no solo que se perdió). */
async function cambiarEtapa(req, res) {
  const { etapa, motivo_perdida } = req.body;
  if (!ETAPAS_VALIDAS.includes(etapa)) {
    throw new ApiError(422, 'ETAPA_INVALIDA', `etapa debe ser una de: ${ETAPAS_VALIDAS.join(', ')}.`);
  }
  if (etapa === 'perdida' && (!motivo_perdida || !motivo_perdida.trim())) {
    throw new ApiError(422, 'MOTIVO_REQUERIDO', 'Indica el motivo al marcar una oportunidad como perdida.');
  }

  const { rows } = await pool.query(
    `UPDATE oportunidades SET etapa = $1, motivo_perdida = $2, actualizado_en = now()
     WHERE id = $3 AND company_id = $4 RETURNING *`,
    [etapa, etapa === 'perdida' ? motivo_perdida.trim() : null, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Oportunidad no encontrada.');

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'oportunidad.cambiar_etapa', entidad: 'oportunidad', entidadId: rows[0].id, detalle: { etapa, motivo_perdida },
  });
  res.json(rows[0]);
}

async function agregarActividad(req, res) {
  const { tipo, descripcion } = req.body;
  if (!descripcion || !descripcion.trim()) throw new ApiError(422, 'DESCRIPCION_REQUERIDA', 'Escribe una descripción para la actividad.');

  const { rows: opRows } = await pool.query('SELECT id FROM oportunidades WHERE id = $1 AND company_id = $2', [req.params.id, req.usuario.companyId]);
  if (!opRows[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Oportunidad no encontrada.');

  const { rows } = await pool.query(
    `INSERT INTO oportunidad_actividades (oportunidad_id, tipo, descripcion, usuario_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, tipo || 'nota', descripcion.trim(), req.usuario.id]
  );
  res.status(201).json(rows[0]);
}

/** Ata una cotización YA CREADA (desde el formulario normal de Nueva cotización, prefiltrado con este cliente) a la oportunidad — trazabilidad, sin duplicar la lógica de crear cotizaciones. */
async function vincularCotizacion(req, res) {
  const { cotizacion_id } = req.body;
  if (!cotizacion_id) throw new ApiError(422, 'COTIZACION_REQUERIDA', 'cotizacion_id es requerido.');

  const { rows: cotRows } = await pool.query('SELECT id FROM cotizaciones WHERE id = $1 AND company_id = $2', [cotizacion_id, req.usuario.companyId]);
  if (!cotRows[0]) throw new ApiError(404, 'COTIZACION_NO_ENCONTRADA', 'La cotización indicada no existe.');

  const { rows } = await pool.query(
    `UPDATE oportunidades SET cotizacion_id = $1, actualizado_en = now() WHERE id = $2 AND company_id = $3 RETURNING *`,
    [cotizacion_id, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADA', 'Oportunidad no encontrada.');
  res.json(rows[0]);
}

module.exports = { listar, obtener, crear, actualizar, cambiarEtapa, agregarActividad, vincularCotizacion };
