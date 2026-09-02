/** Error con código HTTP y código de negocio, para que app.js lo serialice consistente. */
class ApiError extends Error {
  constructor(status, codigo, mensaje, detalle) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

module.exports = ApiError;
