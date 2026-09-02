const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/clientes.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/buscar-dni/:numero', ctrl.buscarDni);
router.get('/buscar-ruc/:numero', ctrl.buscarRuc);
router.get('/:id', ctrl.obtener);
// Cualquiera que puede vender puede registrar/editar un cliente — es parte
// natural del flujo de venta (crear el cliente al vuelo si no existe).
router.post('/', exigirPermiso('emitirBoletaRecibo'), ctrl.crear);
router.put('/:id', exigirPermiso('emitirBoletaRecibo'), ctrl.actualizar);
// Eliminar sí queda solo para admin — a diferencia de crear/editar, borrar
// un cliente no es parte del flujo normal de venta de un cajero/vendedor.
router.delete('/:id', exigirPermiso('gestionarProductos'), ctrl.eliminar);

module.exports = router;
