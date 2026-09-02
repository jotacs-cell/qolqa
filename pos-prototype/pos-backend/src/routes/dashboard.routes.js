const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/dashboard.controller');

// Datos de gestión — no es información que un cajero o vendedor necesite ver.
router.use(verificarToken, exigirPermiso('verReportes'));

router.get('/resumen-hoy', ctrl.resumenHoy);
router.get('/recaudacion-diaria', ctrl.recaudacionDiaria); // ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/productos-top', ctrl.productosTop); // ?desde=&hasta=&limit=
router.get('/rendimiento-vendedores', ctrl.rendimientoVendedores); // ?desde=&hasta=

module.exports = router;
