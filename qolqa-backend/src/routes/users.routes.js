const router = require('express').Router();
const { verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/users.controller');

router.use(verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva);

router.get('/', ctrl.listar);
router.post('/', exigirPermiso('config.users.manage'), ctrl.invitar);
router.patch('/:id/rol', exigirPermiso('config.users.manage'), ctrl.cambiarRol);
router.patch('/:id/estado', exigirPermiso('config.users.manage'), ctrl.cambiarEstado);

module.exports = router;
