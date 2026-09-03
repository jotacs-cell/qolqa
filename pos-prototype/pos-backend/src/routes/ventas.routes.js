const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/ventas.controller');

router.use(verificarToken);

// Cualquier rol autenticado puede vender — cuáles TIPOS de comprobante puede
// emitir cada uno (cajero no puede facturar) se valida dentro de
// ventas.service.js#registrarVenta, porque depende del `tipo_comprobante`
// que va en el body, no de la ruta.
router.post('/', ctrl.crear);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.patch('/:id/anular', exigirPermiso('anularOEmitirNotaCredito'), ctrl.anular);
router.patch('/:id/marcar-pagada', ctrl.marcarPagada);
router.get('/:id/pagos', ctrl.listarPagos);
router.post('/:id/pagos', ctrl.registrarPago);
router.get('/:id/notas', ctrl.listarNotas);
router.post('/:id/notas', ctrl.agregarNota);

module.exports = router;
