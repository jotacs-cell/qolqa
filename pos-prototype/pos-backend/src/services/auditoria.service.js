const { pool } = require('../config/db');

/**
 * Registra una acción en el historial de auditoría. Se llama desde los
 * controllers/servicios que mutan datos sensibles (anular una venta o
 * comprobante, crear/desactivar un producto o usuario, iniciar sesión).
 *
 * Nunca lanza si falla el INSERT (la auditoría no debe tumbar la
 * operación real que está registrando) — solo lo deja en el log del
 * servidor.
 */
async function registrar({ companyId, usuarioId, accion, entidad, entidadId, detalle }) {
  try {
    await pool.query(
      `INSERT INTO auditoria (company_id, usuario_id, accion, entidad, entidad_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, usuarioId || null, accion, entidad || null, entidadId || null, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (err) {
    console.error('No se pudo registrar auditoría:', accion, err.message);
  }
}

async function listar({ companyId, limite = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT a.id, a.accion, a.entidad, a.entidad_id, a.detalle, a.creado_en,
            u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.company_id = $1
      ORDER BY a.creado_en DESC
      LIMIT $2`,
    [companyId, limite]
  );
  return rows;
}

module.exports = { registrar, listar };
