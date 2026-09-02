const { pool } = require('./db');
const ApiError = require('../utils/ApiError');

/**
 * A diferencia del prototipo de un solo negocio (donde la matriz de
 * permisos vivía en un objeto JS fijo), aquí cada empresa puede tener
 * roles PERSONALIZADOS — así que el permiso se resuelve consultando
 * role_permissions/permissions, no comparando contra una lista hardcodeada.
 * Ninguna de las dos tablas tiene Row-Level Security (ver schema.sql) así
 * que esta consulta puede ir directo por `pool`, sin pasar por
 * conContexto — no hace falta contexto de tenant para leerlas.
 */
async function usuarioTienePermiso(roleId, clave) {
  if (!roleId) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 AND p.clave = $2`,
    [roleId, clave]
  );
  return !!rows[0];
}

/** Middleware Express: exige que el rol de req.usuario tenga el permiso dado. */
function exigirPermiso(clave) {
  return async (req, res, next) => {
    try {
      if (!req.usuario) throw new ApiError(401, 'TOKEN_AUSENTE', 'No autenticado.');
      const tiene = await usuarioTienePermiso(req.usuario.roleId, clave);
      if (!tiene) {
        throw new ApiError(403, 'PERMISO_INSUFICIENTE', `Tu rol no tiene permiso para: ${clave}.`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { usuarioTienePermiso, exigirPermiso };
