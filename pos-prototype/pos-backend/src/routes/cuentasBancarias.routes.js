const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const ctrl = require('../controllers/cuentasBancarias.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.put('/:id', ctrl.actualizar);
router.patch('/:id/estado', ctrl.cambiarEstado);
router.delete('/:id', ctrl.eliminar);

module.exports = router;
