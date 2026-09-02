const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const ctrl = require('../controllers/empresas.controller');

// Público a propósito: es el alta de una empresa nueva, todavía no hay
// nadie autenticado en ese momento (igual que /auth/login).
router.post('/', ctrl.crear);

router.get('/mi-empresa/catalogo', verificarToken, ctrl.obtenerCatalogo);
router.put('/mi-empresa/catalogo', verificarToken, ctrl.actualizarCatalogo);
router.get('/mi-empresa/pagos', verificarToken, ctrl.obtenerPagos);
router.put('/mi-empresa/pagos', verificarToken, ctrl.actualizarPagos);
router.get('/mi-empresa/suscripcion', verificarToken, ctrl.obtenerSuscripcion);
router.post('/mi-empresa/comprobantes-pago', verificarToken, ctrl.subirComprobantePago);
router.get('/mi-empresa/comprobantes-pago', verificarToken, ctrl.listarComprobantesPago);

module.exports = router;
