const router = require('express').Router();
const { verificarToken, exigirEmpresaActiva } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/auditoria.controller');

router.get('/', verificarToken, exigirEmpresaActiva, exigirPermiso('config.users.manage'), ctrl.listar);

module.exports = router;
