const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL en las variables de entorno (revisa tu .env)');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Un cliente inactivo del pool tuvo un error inesperado (p.ej. se cayó la conexión).
  // No tumbamos el proceso: solo lo logueamos, el pool crea un cliente nuevo la próxima vez.
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

/**
 * Ejecuta una función dentro de una transacción SQL.
 * Uso: await conTransaccion(async (client) => { ... });
 * Si `fn` lanza un error, se hace ROLLBACK automático y se re-lanza el error.
 */
async function conTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, conTransaccion };
