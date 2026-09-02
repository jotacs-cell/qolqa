const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/auth.controller');

router.post('/login', ctrl.login);

router.get('/permisos', verificarToken, ctrl.permisos); // la matriz de roles, la misma que ve el frontend

router.post('/logout', verificarToken, ctrl.logout);
router.get('/sesiones', verificarToken, ctrl.listarSesiones);
router.delete('/sesiones/:id', verificarToken, ctrl.cerrarSesion);

router.get('/me', verificarToken, ctrl.me);

router.get('/usuarios', verificarToken, exigirPermiso('gestionarUsuarios'), ctrl.listarUsuarios);
router.post('/usuarios', verificarToken, exigirPermiso('gestionarUsuarios'), ctrl.crearUsuario);
router.patch('/usuarios/:id', verificarToken, exigirPermiso('gestionarUsuarios'), ctrl.actualizarUsuario);
router.patch('/usuarios/:id/estado', verificarToken, exigirPermiso('gestionarUsuarios'), ctrl.cambiarEstadoUsuario);

module.exports = router;
