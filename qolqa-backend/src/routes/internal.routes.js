const router = require('express').Router();
const { exigirInternalKey } = require('../middlewares/internalKey');
const ctrl = require('../controllers/internal.controller');

// Llamado solo por pos-backend, servidor a servidor — nunca directo desde
// un navegador (ver exigirInternalKey).
router.use(exigirInternalKey);

router.get('/companies/:ruc/suscripcion', ctrl.obtenerSuscripcion);
router.post('/companies/:ruc/comprobantes', ctrl.subirComprobante);
router.get('/companies/:ruc/comprobantes', ctrl.listarComprobantesEmpresa);

module.exports = router;
