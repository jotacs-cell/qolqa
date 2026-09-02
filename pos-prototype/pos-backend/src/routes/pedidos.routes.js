const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/pedidos.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/', exigirPermiso('emitirBoletaRecibo'), ctrl.crear);
router.put('/:id', exigirPermiso('emitirBoletaRecibo'), ctrl.actualizar);
router.post('/:id/confirmar', exigirPermiso('emitirBoletaRecibo'), ctrl.confirmar);
router.patch('/:id/cancelar', exigirPermiso('emitirBoletaRecibo'), ctrl.cancelar);
router.post('/:id/facturar', exigirPermiso('emitirBoletaRecibo'), ctrl.facturar);

module.exports = router;
