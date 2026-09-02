const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/cotizaciones.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/', exigirPermiso('emitirBoletaRecibo'), ctrl.crear);
router.put('/:id', exigirPermiso('emitirBoletaRecibo'), ctrl.actualizar);
router.patch('/:id/enviar', exigirPermiso('emitirBoletaRecibo'), ctrl.enviar);
router.patch('/:id/rechazar', exigirPermiso('emitirBoletaRecibo'), ctrl.rechazar);
router.post('/:id/confirmar', exigirPermiso('emitirBoletaRecibo'), ctrl.confirmar);

module.exports = router;
