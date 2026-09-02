/**
 * Aplica schema.sql y deja listo el rol de aplicación (sin BYPASSRLS, con
 * el mínimo de privilegios que la API necesita). Corre con una conexión
 * de ADMINISTRADOR (dueña de las tablas) — nunca con qolqa_app, porque
 * las funciones SECURITY DEFINER (user_memberships, crear_empresa) tienen
 * que quedar de propiedad de un rol con privilegios reales para poder
 * saltar RLS de forma controlada. Ver la nota al final de schema.sql.
 *
 * Uso:
 *   DATABASE_URL_ADMIN=postgres://admin:...@host/qolqa \
 *   DB_APP_ROLE=qolqa_app DB_APP_PASSWORD=... \
 *   node src/db/migrate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const NOMBRE_ROL_VALIDO = /^[a-z_][a-z0-9_]*$/;

async function main() {
  const adminUrl = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  const appRole = process.env.DB_APP_ROLE || 'qolqa_app';
  const appPassword = process.env.DB_APP_PASSWORD;

  if (!adminUrl) throw new Error('Define DATABASE_URL_ADMIN (o DATABASE_URL) en tu .env.');
  if (!appPassword) throw new Error('Define DB_APP_PASSWORD en tu .env — la contraseña del rol con el que corre la API.');
  if (!NOMBRE_ROL_VALIDO.test(appRole)) throw new Error(`DB_APP_ROLE "${appRole}" no es un nombre de rol válido.`);

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    console.log(`-> Creando el rol de aplicación "${appRole}" si no existe (sin superusuario, sin BYPASSRLS)...`);
    await client.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appRole}') THEN
           EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', '${appRole}', '${appPassword}');
         END IF;
       END $$;`
    );

    console.log('-> Aplicando src/db/schema.sql...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);

    console.log(`-> Otorgando privilegios mínimos a "${appRole}"...`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${appRole};`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole};`);
    await client.query(`GRANT EXECUTE ON FUNCTION user_memberships(uuid) TO ${appRole};`);
    await client.query(`GRANT EXECUTE ON FUNCTION crear_empresa(text, uuid, varchar, varchar, varchar, uuid) TO ${appRole};`);
    await client.query(`GRANT EXECUTE ON FUNCTION app_company_id() TO ${appRole};`);
    await client.query(`GRANT EXECUTE ON FUNCTION app_user_id() TO ${appRole};`);

    console.log('\nListo. La API debe conectarse con DATABASE_URL apuntando a este rol:');
    console.log(`  postgres://${appRole}:<password>@<host>/<db>`);
    console.log('Nunca con el rol administrador que corrió esta migración.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migración fallida:', err.message);
  process.exit(1);
});
