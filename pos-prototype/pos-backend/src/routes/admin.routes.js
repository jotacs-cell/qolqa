const router = require('express').Router();
const { exigirAdminKey } = require('../middlewares/auth');
const ctrl = require('../controllers/admin.controller');

router.use(exigirAdminKey);

router.get('/empresas/:ruc/nubefact', ctrl.obtenerNubefact);
router.put('/empresas/:ruc/nubefact', ctrl.actualizarNubefact);
router.get('/empresas/:ruc/usuarios', ctrl.obtenerUsuarios);
router.post('/empresas/:ruc/usuarios', ctrl.crearUsuarioEmpresa);
router.patch('/empresas/:ruc/usuarios/:usuarioId', ctrl.actualizarUsuarioEmpresa);
router.patch('/empresas/:ruc/usuarios/:usuarioId/estado', ctrl.cambiarEstadoUsuarioEmpresa);
router.delete('/empresas/:ruc/usuarios/:usuarioId', ctrl.eliminarUsuarioEmpresa);
router.get('/empresas/:ruc/auditoria', ctrl.auditoriaEmpresa);
router.get('/permisos', ctrl.obtenerMatrizPermisos);
router.get('/empresas/:ruc/permisos', ctrl.obtenerPermisosEmpresa);
router.put('/empresas/:ruc/permisos/:accion', ctrl.actualizarPermisoEmpresa);
router.delete('/empresas/:ruc/permisos/:accion', ctrl.restaurarPermisoEmpresa);
router.get('/facturacion/alertas', ctrl.alertasFacturacion);
router.get('/comprobantes/:id/pdf', ctrl.verComprobantePdf);
router.post('/comprobantes/:id/reintentar', ctrl.reintentarComprobante);
router.patch('/empresas/:ruc/usuarios/:usuarioId/reset-password', ctrl.resetearPasswordUsuario);

module.exports = router;
