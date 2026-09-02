const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { conContexto } = require('../config/db');

/**
 * Valida el JWT y, además, que la sesión (jti) siga vigente en la tabla
 * `sessions` — un JWT robado pero cuya sesión ya se cerró (logout, o un
 * admin que forzó el cierre desde otro dispositivo) deja de servir aunque
 * todavía no haya expirado. Deja en req.usuario: { id, companyId, roleId, jti }.
 *
 * companyId sale del propio token — nunca de un header o de query string
 * que el cliente pudiera falsificar (ver arquitectura-erp-saas-peru.html,
 * sección 04, capa 1).
 */
async function verificarToken(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'TOKEN_AUSENTE', 'No autenticado.');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      throw new ApiError(401, 'TOKEN_INVALIDO', 'Token inválido o expirado.');
    }

    await conContexto({ userId: payload.sub }, async (client) => {
      const { rows } = await client.query(
        'SELECT id FROM sessions WHERE jti = $1 AND revocada_en IS NULL',
        [payload.jti]
      );
      if (!rows[0]) throw new ApiError(401, 'SESION_REVOCADA', 'Tu sesión ya no es válida — inicia sesión de nuevo.');
      // fire-and-forget: no hace falta esperar a que esto termine para responder
      client.query('UPDATE sessions SET ultimo_uso_en = now() WHERE jti = $1', [payload.jti]).catch(() => {});
    });

    req.usuario = {
      id: payload.sub,
      companyId: payload.companyId || null,
      roleId: payload.roleId || null,
      jti: payload.jti,
      esSuperAdmin: !!payload.esSuperAdmin,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Exige que el usuario autenticado tenga una empresa activa en el token
 * (rutas de negocio, no las de "antes de elegir empresa" como /companies/mine). */
function exigirEmpresaActiva(req, res, next) {
  if (!req.usuario || !req.usuario.companyId) {
    return next(new ApiError(409, 'SIN_EMPRESA_ACTIVA', 'Elige una empresa antes de continuar.'));
  }
  next();
}

/**
 * Bloqueo automático de Fase 2: corta el acceso a rutas de negocio cuando
 * la suscripción de la empresa activa venció o fue suspendida por el super
 * admin. No confía solo en companies.estado_suscripcion (nadie la actualiza
 * sola con el paso del tiempo — no hay cron) — revisa suscripcion_vencimiento
 * en cada request y, si ya pasó, la marca 'vencido' al vuelo. Deliberadamente
 * NO se cuelga de /auth/me: el frontend necesita poder leer el estado de la
 * empresa (para mostrar el aviso de pago) incluso cuando está vencida.
 */
async function exigirSuscripcionActiva(req, res, next) {
  try {
    if (!req.usuario || !req.usuario.companyId) {
      return next(new ApiError(409, 'SIN_EMPRESA_ACTIVA', 'Elige una empresa antes de continuar.'));
    }
    const bloqueada = await conContexto(
      { userId: req.usuario.id, companyId: req.usuario.companyId },
      async (client) => {
        const { rows } = await client.query(
          'SELECT estado_suscripcion, suscripcion_vencimiento FROM companies WHERE id = $1',
          [req.usuario.companyId]
        );
        const empresa = rows[0];
        if (!empresa) return true; // no debería pasar: companyId viene de un token válido

        if (empresa.estado_suscripcion === 'suspendido') return true;

        const hoy = new Date(new Date().toDateString());
        const vencida = empresa.suscripcion_vencimiento && new Date(empresa.suscripcion_vencimiento) < hoy;
        if (vencida && empresa.estado_suscripcion !== 'vencido') {
          await client.query("UPDATE companies SET estado_suscripcion = 'vencido' WHERE id = $1", [
            req.usuario.companyId,
          ]);
        }
        return Boolean(vencida) || empresa.estado_suscripcion === 'vencido';
      }
    );

    if (bloqueada) {
      return next(
        new ApiError(402, 'SUSCRIPCION_VENCIDA', 'Tu suscripción venció o fue suspendida — regulariza el pago para continuar.')
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Rutas de /api/v1/admin/* — cross-tenant, solo para el dueño de la
 * plataforma. El claim viene del JWT (firmado en login), pero el acceso real
 * a datos de otras empresas lo revalida además la política RLS
 * companies_visible_superadmin contra users.es_superadmin en vivo — si a
 * alguien se le revoca el flag a mitad de una sesión de 12h, deja de ver
 * datos ajenos aunque su token todavía diga esSuperAdmin: true. */
function exigirSuperAdmin(req, res, next) {
  if (!req.usuario || !req.usuario.esSuperAdmin) {
    return next(new ApiError(403, 'NO_AUTORIZADO', 'Esta sección es solo para administradores de la plataforma.'));
  }
  next();
}

module.exports = { verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva, exigirSuperAdmin };
