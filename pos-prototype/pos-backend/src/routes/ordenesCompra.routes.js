const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/ordenesCompra.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/', exigirPermiso('gestionarProductos'), ctrl.crear);
router.put('/:id', exigirPermiso('gestionarProductos'), ctrl.actualizar);
router.patch('/:id/confirmar', exigirPermiso('gestionarProductos'), ctrl.confirmar);
router.patch('/:id/cancelar', exigirPermiso('gestionarProductos'), ctrl.cancelar);
router.post('/:id/recibir', exigirPermiso('gestionarProductos'), ctrl.recibir);

module.exports = router;
