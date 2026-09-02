const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const ctrl = require('../controllers/oportunidades.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/', ctrl.crear);
router.put('/:id', ctrl.actualizar);
router.patch('/:id/etapa', ctrl.cambiarEtapa);
router.post('/:id/actividades', ctrl.agregarActividad);
router.patch('/:id/vincular-cotizacion', ctrl.vincularCotizacion);

module.exports = router;
