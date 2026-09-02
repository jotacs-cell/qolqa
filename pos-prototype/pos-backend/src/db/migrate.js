// Ejecuta schema.sql contra la base de datos indicada en DATABASE_URL.
// Uso: npm run db:migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();
  try {
    await client.query(sql);
    console.log('Esquema aplicado correctamente.');
  } finally {
    await client.end();
  }
}

migrar().catch((err) => {
  console.error('Error aplicando el esquema:', err.message);
  process.exit(1);
});
