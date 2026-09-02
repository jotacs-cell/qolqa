const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/compras.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/', exigirPermiso('gestionarProductos'), ctrl.crear);
router.patch('/:id/anular', exigirPermiso('gestionarProductos'), ctrl.anular);
router.patch('/:id/marcar-pagada', exigirPermiso('gestionarProductos'), ctrl.marcarPagada);

module.exports = router;
