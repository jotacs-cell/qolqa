/**
 * Siembra el catálogo de permisos y los 4 roles plantilla (admin, vendedor,
 * almacenero, contabilidad — sección 3 del encargo). Se puede correr con
 * la conexión normal de la API (DATABASE_URL, el rol qolqa_app): insertar
 * una fila con company_id NULL siempre cumple la política de roles, sin
 * necesitar privilegios especiales — probado en vivo antes de escribir
 * este archivo.
 *
 * A propósito, vendedor/almacenero/contabilidad quedan sembrados SIN
 * permisos todavía: los permisos reales de ventas, inventario y reportes
 * no existen como acciones hasta que se construyan esas fases (3, 5 y 8).
 * Fase 1 solo deja el andamiaje — el ejemplo del encargo ("un vendedor
 * podría emitir una boleta, pero no anularla") se resuelve recién cuando
 * exista sales.invoice.create/void en el catálogo.
 */
require('dotenv').config();
const { Pool } = require('pg');

const PERMISOS = [
  ['config.company.manage', 'Editar los datos de la empresa'],
  ['config.branches.manage', 'Crear y editar sucursales'],
  ['config.users.manage', 'Invitar usuarios, cambiar sus roles y ver la auditoría'],
  ['config.roles.manage', 'Crear roles personalizados'],
];

const ROLES = [
  { nombre: 'admin', permisos: PERMISOS.map((p) => p[0]) },
  { nombre: 'vendedor', permisos: [] },
  { nombre: 'almacenero', permisos: [] },
  { nombre: 'contabilidad', permisos: [] },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('-> Sembrando catálogo de permisos...');
  for (const [clave, descripcion] of PERMISOS) {
    await pool.query(
      `INSERT INTO permissions (clave, descripcion) VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion`,
      [clave, descripcion]
    );
  }

  console.log('-> Sembrando roles plantilla...');
  for (const rol of ROLES) {
    const { rows } = await pool.query(
      `INSERT INTO roles (company_id, nombre, es_personalizado) VALUES (NULL, $1, false)
       ON CONFLICT (company_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`,
      [rol.nombre]
    );
    const roleId = rows[0].id;

    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (rol.permisos.length > 0) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE clave = ANY($2::text[])`,
        [roleId, rol.permisos]
      );
    }
    console.log(`   ${rol.nombre}: ${rol.permisos.length} permiso(s)`);
  }

  console.log('\nListo. Ya puedes registrar la primera empresa (POST /api/v1/auth/registrar).');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed fallido:', err.message);
  process.exit(1);
});
