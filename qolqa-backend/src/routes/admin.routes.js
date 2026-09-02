const router = require('express').Router();
const { verificarToken, exigirSuperAdmin } = require('../middlewares/auth');
const ctrl = require('../controllers/admin.controller');

// No exigirEmpresaActiva: el super admin opera cross-tenant, no dentro de
// una empresa concreta.
router.use(verificarToken, exigirSuperAdmin);

router.get('/metrics', ctrl.metricas);
router.get('/companies', ctrl.listarEmpresas);
router.post('/companies', ctrl.crearEmpresa);
router.get('/pagos', ctrl.pagosGlobal);
router.get('/comprobantes', ctrl.listarComprobantes);
router.get('/comprobantes/:id/archivo', ctrl.obtenerArchivoComprobante);
router.post('/comprobantes/:id/aprobar', ctrl.aprobarComprobante);
router.post('/comprobantes/:id/rechazar', ctrl.rechazarComprobante);
router.get('/companies/:id/pagos', ctrl.pagosDeEmpresa);
router.post('/companies/:id/pagos', ctrl.registrarPago);
router.post('/companies/:id/suspender', ctrl.suspender);
router.post('/companies/:id/reactivar', ctrl.reactivar);
router.get('/companies/:id/nubefact', ctrl.obtenerNubefact);
router.put('/companies/:id/nubefact', ctrl.actualizarNubefact);
router.get('/companies/:id/usuarios', ctrl.obtenerUsuariosEmpresa);
router.post('/companies/:id/usuarios', ctrl.crearUsuarioEmpresa);
router.patch('/companies/:id/usuarios/:usuarioId', ctrl.actualizarUsuarioEmpresa);
router.patch('/companies/:id/usuarios/:usuarioId/estado', ctrl.cambiarEstadoUsuarioEmpresa);
router.delete('/companies/:id/usuarios/:usuarioId', ctrl.eliminarUsuarioEmpresa);
router.get('/companies/:id/auditoria', ctrl.auditoriaEmpresa);
router.get('/permisos', ctrl.obtenerMatrizPermisos);
router.get('/companies/:id/permisos', ctrl.obtenerPermisosEmpresa);
router.put('/companies/:id/permisos/:accion', ctrl.actualizarPermisoEmpresa);
router.delete('/companies/:id/permisos/:accion', ctrl.restaurarPermisoEmpresa);
router.get('/facturacion/alertas', ctrl.alertasFacturacion);
router.get('/comprobantes-electronicos/:id/pdf', ctrl.verComprobantePdf);
router.post('/comprobantes-electronicos/:id/reintentar', ctrl.reintentarComprobante);
router.get('/planes', ctrl.listarPlanes);
router.post('/planes', ctrl.crearPlan);
router.put('/planes/:id', ctrl.actualizarPlan);
router.patch('/companies/:id/usuarios/:usuarioId/reset-password', ctrl.resetearPasswordUsuarioEmpresa);
router.put('/companies/:id', ctrl.actualizarDatosEmpresa);

module.exports = router;
