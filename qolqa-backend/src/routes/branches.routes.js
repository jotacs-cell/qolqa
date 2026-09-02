const router = require('express').Router();
const { verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/branches.controller');

router.use(verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva);

router.get('/', ctrl.listar);
router.post('/', exigirPermiso('config.branches.manage'), ctrl.crear);
router.patch('/:id/estado', exigirPermiso('config.branches.manage'), ctrl.cambiarEstado);

module.exports = router;
