/**
 * Registra una acción en audit_logs. Recibe el `client` de la transacción
 * en curso (no pool) porque audit_logs tiene Row-Level Security por
 * company_id — debe insertarse con el mismo contexto de tenant que el
 * resto de la operación, dentro de la misma transacción que ya lo tiene
 * fijado (ver config/db.js#conContexto).
 *
 * Nunca lanza: un fallo al auditar no debe tumbar la operación real que
 * se estaba auditando. Si algo falla, se registra en consola y se sigue.
 */
async function registrar(client, { companyId, userId, accion, entidad, entidadId, valorAnterior, valorNuevo, ip }) {
  try {
    await client.query(
      `INSERT INTO audit_logs (company_id, user_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        companyId || null,
        userId || null,
        accion,
        entidad || null,
        entidadId || null,
        valorAnterior ? JSON.stringify(valorAnterior) : null,
        valorNuevo ? JSON.stringify(valorNuevo) : null,
        ip || null,
      ]
    );
  } catch (err) {
    console.error('[auditoria] no se pudo registrar la acción:', accion, err.message);
  }
}

module.exports = { registrar };
