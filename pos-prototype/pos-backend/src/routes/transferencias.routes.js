const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/transferencias.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.post('/', exigirPermiso('gestionarProductos'), ctrl.crear);

module.exports = router;
