const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const ctrl = require('../controllers/caja.controller');

router.use(verificarToken);

// Abrir/cerrar turno y registrar movimientos es trabajo rutinario de
// cualquier cajero/vendedor en su propio turno — no requiere permiso de
// administrador (a diferencia de almacenes/proveedores/etc.).
router.get('/actual', ctrl.actual);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/abrir', ctrl.abrir);
router.post('/:id/movimientos', ctrl.movimiento);
router.patch('/:id/cerrar', ctrl.cerrar);

module.exports = router;
