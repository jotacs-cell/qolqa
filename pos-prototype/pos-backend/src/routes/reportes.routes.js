const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/reportes.controller');

router.use(verificarToken);

// /api/reportes/ventas | compras | inventario | igv ?desde=&hasta=&formato=json|csv|xlsx|pdf
router.get('/:tipo', exigirPermiso('verReportes'), ctrl.generar);

module.exports = router;
