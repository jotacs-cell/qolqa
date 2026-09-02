const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/proveedores.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/buscar-ruc/:numero', ctrl.buscarRuc);
router.get('/:id', ctrl.obtener);
router.post('/', exigirPermiso('gestionarProductos'), ctrl.crear);
router.put('/:id', exigirPermiso('gestionarProductos'), ctrl.actualizar);
router.delete('/:id', exigirPermiso('gestionarProductos'), ctrl.eliminar);

module.exports = router;
