const { pool } = require('./db');

// Matriz de permisos por rol — el valor por DEFECTO para toda empresa que
// no la haya personalizado. Cualquier empresa puede tener su propia
// versión de una acción puntual en la tabla `permisos_empresa` (ver
// admin.controller.js#obtenerPermisosEmpresa/actualizarPermisoEmpresa,
// gestionado desde Super Admin) — si no la tiene, cae aquí.
//
//   admin:     acceso total.
//   vendedor:  emite boleta, factura y recibo. No anula ni gestiona nada más.
//   cajero:    emite boleta y recibo (NO factura). No anula ni gestiona nada más.
//   contador:  anula comprobantes / emite notas de crédito, ve reportes.
//              No vende ni gestiona productos ni usuarios.
const PERMISOS = {
  emitirBoletaRecibo: ['admin', 'vendedor', 'cajero'],
  emitirFactura: ['admin', 'vendedor'],
  anularOEmitirNotaCredito: ['admin', 'contador'],
  gestionarProductos: ['admin'],
  gestionarUsuarios: ['admin'],
  verReportes: ['admin', 'contador'],
};

/** Roles/permisos de una empresa, ya resueltos: personalizado si lo tiene,
 * si no el default de arriba. Una sola consulta indexada por PK — barata
 * incluso con cientos de empresas. */
async function permisosEfectivos(companyId) {
  if (!companyId) return PERMISOS;
  const { rows } = await pool.query(
    'SELECT accion, roles FROM permisos_empresa WHERE company_id = $1',
    [companyId]
  );
  if (rows.length === 0) return PERMISOS;
  const efectivo = { ...PERMISOS };
  for (const fila of rows) efectivo[fila.accion] = fila.roles;
  return efectivo;
}

async function tienePermiso(companyId, rol, accion) {
  const permisos = await permisosEfectivos(companyId);
  const permitidos = permisos[accion];
  if (!permitidos) throw new Error(`Acción de permiso desconocida: "${accion}".`);
  return permitidos.includes(rol);
}

/** Middleware Express: exige que req.usuario.rol tenga el permiso dado,
 * ya resuelto para la empresa de ese usuario (con su personalización si
 * la tiene). */
function exigirPermiso(accion) {
  return async (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: { codigo: 'TOKEN_AUSENTE', mensaje: 'No autenticado.' } });
    }
    const permitido = await tienePermiso(req.usuario.companyId, req.usuario.rol, accion);
    if (!permitido) {
      return res.status(403).json({
        error: {
          codigo: 'PERMISO_INSUFICIENTE',
          mensaje: `Tu rol (${req.usuario.rol}) no tiene permiso para: ${accion}.`,
        },
      });
    }
    next();
  };
}

module.exports = { PERMISOS, permisosEfectivos, tienePermiso, exigirPermiso };
