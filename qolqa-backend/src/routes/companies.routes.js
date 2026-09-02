const router = require('express').Router();
const { verificarToken, exigirEmpresaActiva, exigirSuscripcionActiva } = require('../middlewares/auth');
const { exigirPermiso } = require('../config/permisos');
const ctrl = require('../controllers/companies.controller');

router.post('/', verificarToken, ctrl.agregar); // "+ Agregar empresa" — no exige empresa activa

router.get('/activa', verificarToken, exigirEmpresaActiva, ctrl.obtenerActiva); // se lee incluso vencida, para mostrar el aviso
router.patch(
  '/activa',
  verificarToken,
  exigirEmpresaActiva,
  exigirSuscripcionActiva,
  exigirPermiso('config.company.manage'),
  ctrl.actualizar
);

module.exports = router;
