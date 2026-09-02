const router = require('express').Router();
const { verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/roles.controller');

router.use(verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva);

router.get('/permisos', ctrl.listarPermisos);
router.get('/', ctrl.listar);
router.post('/', exigirPermiso('config.roles.manage'), ctrl.crear);

module.exports = router;
