const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * TODA lectura o escritura sobre una tabla protegida por Row-Level Security
 * (companies, branches, roles, company_users, sessions, audit_logs) debe
 * pasar por aquí — nunca por pool.query() directo. Este helper:
 *
 *   1. Toma una conexión del pool y abre una transacción.
 *   2. Fija app.company_id / app.user_id con SET LOCAL (vía set_config,
 *      parametrizado — nunca interpolando el valor en el texto del SQL).
 *   3. Corre fn(client) — todo lo que fn haga queda sujeto a esas políticas.
 *   4. Hace COMMIT si todo salió bien, ROLLBACK si algo lanzó un error.
 *
 * Detalle importante de Postgres que vale la pena dejar escrito: una vez
 * que un GUC de aplicación (como app.company_id) se fijó con SET LOCAL en
 * ALGUNA transacción de una conexión, current_setting(..., true) ya no
 * vuelve a devolver NULL en esa conexión — al terminar la transacción
 * "revierte" a '' (cadena vacía), no a NULL. Como las políticas hacen
 * `current_setting(...)::uuid`, una cadena vacía sin fijar de nuevo hace
 * que la consulta falle con un error de conversión de tipo, en vez de
 * devolver datos de otra empresa. O sea: si algún día alguien olvida pasar
 * por este helper, el resultado es un error 500 ruidoso, nunca una fuga
 * silenciosa de datos — falla cerrado, no abierto. Aun así, la regla es:
 * SIEMPRE por aquí, nunca pool.query() directo sobre una tabla con RLS.
 */
async function conContexto({ companyId, userId } = {}, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    if (companyId) await client.query('SELECT set_config($1, $2, true)', ['app.company_id', companyId]);
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, conContexto };
