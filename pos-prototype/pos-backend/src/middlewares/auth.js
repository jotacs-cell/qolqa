const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

/** Exige un JWT válido en el header Authorization: Bearer <token>, y que la
 * sesión asociada (claim "jti") no haya sido revocada — ver control de
 * sesiones en auth.controller.js#cerrarSesion. Un JWT por sí solo no se
 * puede "invalidar" antes de que expire; por eso cada login queda
 * registrado en la tabla `sesiones` y esta verificación consulta si esa
 * fila sigue vigente. */
async function verificarToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return res.status(401).json({
      error: { codigo: 'TOKEN_AUSENTE', mensaje: 'Falta el header Authorization: Bearer <token>.' },
    });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({
      error: { codigo: 'TOKEN_INVALIDO', mensaje: 'El token es inválido o expiró.' },
    });
  }

  if (payload.jti) {
    const { rows } = await pool.query(
      'SELECT id FROM sesiones WHERE jti = $1 AND revocada_en IS NULL',
      [payload.jti]
    );
    if (!rows[0]) {
      return res.status(401).json({
        error: { codigo: 'SESION_REVOCADA', mensaje: 'Esta sesión fue cerrada. Inicia sesión de nuevo.' },
      });
    }
    pool.query('UPDATE sesiones SET ultimo_uso_en = now() WHERE jti = $1', [payload.jti]).catch(() => {});
  }

  req.usuario = payload; // { id, nombre, email, rol, jti }
  next();
}

/** Exige que req.usuario.rol esté dentro de los roles permitidos.
 * Para permisos por acción (no por rol pegado a cada ruta) usar
 * exigirPermiso() de config/permisos.js en su lugar. */
function verificarRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: { codigo: 'TOKEN_AUSENTE', mensaje: 'No autenticado.' } });
    }
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({
        error: {
          codigo: 'ROL_INSUFICIENTE',
          mensaje: `Esta acción requiere uno de estos roles: ${rolesPermitidos.join(', ')}.`,
        },
      });
    }
    next();
  };
}

/**
 * Protege /api/admin/* — no es un usuario con JWT, es qolqa-backend
 * llamando server a server para configurar NubeFacT por RUC desde el
 * panel de Super Admin (ver docs/arquitectura-erp-saas-peru.html: el
 * super admin nunca comparte login con las empresas). PLATFORM_ADMIN_KEY
 * vive solo en los .env de ambos backends, nunca llega al navegador.
 */
function exigirAdminKey(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!process.env.PLATFORM_ADMIN_KEY || key !== process.env.PLATFORM_ADMIN_KEY) {
    return res.status(401).json({ error: { codigo: 'ADMIN_KEY_INVALIDA', mensaje: 'No autorizado.' } });
  }
  next();
}

module.exports = { verificarToken, verificarRol, exigirAdminKey };
