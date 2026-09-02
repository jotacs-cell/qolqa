const router = require('express').Router();
const ctrl = require('../controllers/catalogo.controller');

// Público a propósito — ver la nota en catalogo.controller.js.
router.get('/:slug', ctrl.obtenerPublico);

module.exports = router;
