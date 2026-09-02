const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/productos.controller');

router.use(verificarToken); // todo /api/productos exige estar autenticado

router.get('/', ctrl.listar);
router.get('/codigo/:codigo_barras', ctrl.obtenerPorCodigoBarras);
router.get('/:id', ctrl.obtener);

router.post('/', exigirPermiso('gestionarProductos'), ctrl.crear);
router.put('/:id', exigirPermiso('gestionarProductos'), ctrl.actualizar);
router.patch('/:id/estado', exigirPermiso('gestionarProductos'), ctrl.cambiarEstado);
router.patch('/:id/stock', exigirPermiso('gestionarProductos'), ctrl.ajustarStock);

module.exports = router;
