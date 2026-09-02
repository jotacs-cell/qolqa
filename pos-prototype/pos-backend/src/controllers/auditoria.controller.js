const auditoriaService = require('../services/auditoria.service');

/**
 * Historial de auditoría (módulo Usuarios y seguridad → Auditoría en el
 * frontend). Solo lectura — las escrituras las hacen los controllers que
 * mutan datos, llamando a auditoriaService.registrar() directamente.
 */
async function listar(req, res) {
  const limite = Math.min(parseInt(req.query.limite, 10) || 100, 500);
  const filas = await auditoriaService.listar({ companyId: req.usuario.companyId, limite });
  res.json(filas);
}

module.exports = { listar };
