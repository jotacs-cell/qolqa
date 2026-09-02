const ApiError = require('../utils/ApiError');

/**
 * Reserva el siguiente correlativo de una serie, DENTRO de una transacción
 * ya abierta (recibe el `client`, no el pool). El SELECT ... FOR UPDATE
 * bloquea la fila de la serie hasta el COMMIT/ROLLBACK, así que si dos
 * ventas concurrentes piden un correlativo de la misma serie, la segunda
 * espera a que la primera termine — nunca se repite un número.
 */
async function reservarCorrelativo(client, companyId, tipoComprobante, serieForzada) {
  const { rows } = await client.query(
    `SELECT id, serie, correlativo_actual
       FROM series_comprobantes
      WHERE company_id = $1 AND tipo_comprobante = $2 AND activa = TRUE
        AND ($3::varchar IS NULL OR serie = $3)
      ORDER BY id
      LIMIT 1
      FOR UPDATE`,
    [companyId, tipoComprobante, serieForzada || null]
  );

  const fila = rows[0];
  if (!fila) {
    throw new ApiError(
      500,
      'SERIE_NO_CONFIGURADA',
      `No hay una serie activa configurada para "${tipoComprobante}". Revisa la tabla series_comprobantes.`
    );
  }

  const nuevoCorrelativo = Number(fila.correlativo_actual) + 1;
  await client.query('UPDATE series_comprobantes SET correlativo_actual = $1 WHERE id = $2', [
    nuevoCorrelativo,
    fila.id,
  ]);

  return { serie: fila.serie, correlativo: nuevoCorrelativo };
}

module.exports = { reservarCorrelativo };
