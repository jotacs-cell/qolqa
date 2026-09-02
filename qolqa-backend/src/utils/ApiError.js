/** Error controlado: el controlador/servicio decide status+código, el
 * manejador central de app.js lo convierte en la respuesta JSON.
 * Nunca se le muestra al usuario un stack trace ni un mensaje de Postgres
 * en crudo — eso solo va a console.error (ver middlewares/errorHandler.js).
 */
class ApiError extends Error {
  constructor(status, codigo, mensaje, detalle) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

module.exports = ApiError;
