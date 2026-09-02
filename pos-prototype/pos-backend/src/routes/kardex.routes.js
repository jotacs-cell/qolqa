const router = require('express').Router();
const { verificarToken } = require('../middlewares/auth');
const ctrl = require('../controllers/kardex.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);

module.exports = router;
