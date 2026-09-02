const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/comprobantes.controller');

router.use(verificarToken);

router.get('/:id', ctrl.obtener);
router.get('/:id/xml', ctrl.descargarXml);
router.get('/:id/cdr', ctrl.descargarCdr);
router.get('/:id/pdf', ctrl.descargarPdf);
router.get('/:id/ticket', ctrl.descargarTicket);
router.patch('/:id/reenviar', exigirPermiso('anularOEmitirNotaCredito'), ctrl.reenviar);

// Notas de crédito y anulación (solo sobre facturas/boletas ya aceptadas)
router.get('/:id/notas-credito', ctrl.listarNotasCredito);
router.post('/:id/notas-credito', exigirPermiso('anularOEmitirNotaCredito'), ctrl.crearNotaCredito);
router.patch('/:id/anular', exigirPermiso('anularOEmitirNotaCredito'), ctrl.anularComprobante);

module.exports = router;
