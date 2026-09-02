const { pool, conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

/** Catálogo completo de permisos — es global, sin RLS, va directo por pool. */
async function listarPermisos(req, res) {
  const { rows } = await pool.query('SELECT id, clave, descripcion FROM permissions ORDER BY clave');
  res.json(rows);
}

/** Roles visibles para la empresa activa: las plantillas del sistema +
 * los personalizados de esta empresa — nunca los de otra (roles_tenant_or_template). */
async function listar(req, res) {
  const roles = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.nombre, r.es_personalizado, r.company_id,
              COALESCE(array_agg(p.clave) FILTER (WHERE p.clave IS NOT NULL), '{}') AS permisos
         FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
        GROUP BY r.id
        ORDER BY r.es_personalizado, r.nombre`
    );
    return rows;
  });
  res.json(roles);
}

/** Crea un rol personalizado de la empresa activa con un subconjunto de
 * permisos del catálogo — la parte de "permisos por módulo" del punto 1. */
async function crear(req, res) {
  const { nombre, permisos } = req.body;
  if (!nombre) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre es requerido.');
  if (permisos && !Array.isArray(permisos)) throw new ApiError(422, 'PERMISOS_INVALIDOS', 'permisos debe ser un arreglo de claves.');

  const rol = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows: rolRows } = await client.query(
      `INSERT INTO roles (company_id, nombre, es_personalizado) VALUES ($1, $2, true) RETURNING *`,
      [req.usuario.companyId, nombre]
    );
    const nuevoRol = rolRows[0];

    if (permisos && permisos.length > 0) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE clave = ANY($2::text[])`,
        [nuevoRol.id, permisos]
      );
    }

    await auditoria.registrar(client, {
      companyId: req.usuario.companyId,
      userId: req.usuario.id,
      accion: 'rol.crear',
      entidad: 'role',
      entidadId: nuevoRol.id,
      valorNuevo: { nombre, permisos },
      ip: req.ip,
    });

    return nuevoRol;
  });

  res.status(201).json(rol);
}

module.exports = { listarPermisos, listar, crear };
