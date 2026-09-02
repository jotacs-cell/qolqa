const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/auditoria.controller');

// Mismo permiso que la gestión de usuarios: quien administra usuarios y
// roles es quien necesita poder revisar qué hizo cada quien.
router.get('/', verificarToken, exigirPermiso('gestionarUsuarios'), ctrl.listar);

module.exports = router;
