const ApiError = require('../utils/ApiError');

/**
 * Autentica llamadas servidor-a-servidor desde pos-backend (dirección
 * inversa al proxy que ya existe para Super Admin — ver admin.controller.js
 * POS_BACKEND_ADMIN_KEY). pos-backend no tiene un usuario/JWT de este
 * sistema, así que se identifica con esta clave compartida en vez de
 * verificarToken.
 */
function exigirInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!process.env.QOLQA_INTERNAL_KEY) {
    return next(new ApiError(500, 'PROXY_NO_CONFIGURADO', 'Falta QOLQA_INTERNAL_KEY en el .env.'));
  }
  if (key !== process.env.QOLQA_INTERNAL_KEY) {
    return next(new ApiError(401, 'CLAVE_INVALIDA', 'Clave interna inválida.'));
  }
  next();
}

module.exports = { exigirInternalKey };
