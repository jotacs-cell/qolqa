const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/almacenes.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.post('/', exigirPermiso('gestionarProductos'), ctrl.crear);
router.put('/:id', exigirPermiso('gestionarProductos'), ctrl.actualizar);
router.patch('/:id/marcar-principal', exigirPermiso('gestionarProductos'), ctrl.marcarPrincipal);

module.exports = router;
