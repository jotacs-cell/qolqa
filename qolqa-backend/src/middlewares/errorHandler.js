const ApiError = require('../utils/ApiError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { codigo: err.codigo, mensaje: err.message, detalle: err.detalle } });
  }

  // Errores de Postgres con código conocido → una respuesta legible, nunca
  // el mensaje crudo del motor (requisito 36: manejo de errores amigable).
  if (err.code === '23505') {
    return res.status(409).json({ error: { codigo: 'DUPLICADO', mensaje: 'Ese registro ya existe.' } });
  }
  if (err.message && err.message.includes('row-level security')) {
    // Esto NO debería pasar nunca en uso normal — si aparece, es una señal
    // de que algo intentó saltarse el aislamiento entre empresas.
    console.error('[seguridad] intento bloqueado por Row-Level Security:', err.message);
    return res.status(403).json({ error: { codigo: 'ACCESO_DENEGADO', mensaje: 'No tienes acceso a ese recurso.' } });
  }

  console.error(err);
  res.status(500).json({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Se produjo un inconveniente. Intenta nuevamente.' } });
}

module.exports = errorHandler;
