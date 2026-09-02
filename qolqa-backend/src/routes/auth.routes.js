const router = require('express').Router();
const { verificarToken, exigirEmpresaActiva } = require('../middlewares/auth');
const ctrl = require('../controllers/auth.controller');

router.post('/registrar', ctrl.registrar);
router.post('/login', ctrl.login);

router.get('/me', verificarToken, exigirEmpresaActiva, ctrl.me);
router.get('/empresas', verificarToken, ctrl.misEmpresas); // no exige empresa activa: ES el selector
router.post('/cambiar-empresa', verificarToken, ctrl.cambiarEmpresa);
router.post('/cambiar-password', verificarToken, ctrl.cambiarPassword);

router.post('/logout', verificarToken, ctrl.logout);
router.get('/sesiones', verificarToken, ctrl.misSesiones);
router.delete('/sesiones/:id', verificarToken, ctrl.cerrarSesion);

module.exports = router;
