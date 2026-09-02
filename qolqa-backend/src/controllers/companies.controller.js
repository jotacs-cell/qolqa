const { pool, conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

const RUC_REGEX = /^\d{11}$/;

async function obtenerActiva(req, res) {
  const empresa = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('SELECT * FROM companies WHERE id = $1', [req.usuario.companyId]);
    return rows[0];
  });
  if (!empresa) throw new ApiError(404, 'NO_ENCONTRADA', 'Empresa no encontrada.');
  res.json(empresa);
}

async function actualizar(req, res) {
  const { razon_social, nombre_comercial, direccion, ubigeo, telefono, correo } = req.body;

  const actualizada = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `UPDATE companies SET
         razon_social = COALESCE($1, razon_social),
         nombre_comercial = COALESCE($2, nombre_comercial),
         direccion = COALESCE($3, direccion),
         ubigeo = COALESCE($4, ubigeo),
         telefono = COALESCE($5, telefono),
         correo = COALESCE($6, correo)
       WHERE id = $7
       RETURNING *`,
      [razon_social, nombre_comercial, direccion, ubigeo, telefono, correo, req.usuario.companyId]
    );
    const empresa = rows[0];
    if (empresa) {
      await auditoria.registrar(client, {
        companyId: req.usuario.companyId,
        userId: req.usuario.id,
        accion: 'empresa.actualizar',
        entidad: 'company',
        entidadId: empresa.id,
        valorNuevo: req.body,
        ip: req.ip,
      });
    }
    return empresa;
  });

  if (!actualizada) throw new ApiError(404, 'NO_ENCONTRADA', 'Empresa no encontrada.');
  res.json(actualizada);
}

/** "+ Agregar empresa" del selector — un usuario YA logueado suma otro RUC
 * a su cuenta. Usa el mismo crear_empresa() angosto que el registro. */
async function agregar(req, res) {
  const { ruc, razon_social, nombre_comercial } = req.body;
  if (!ruc || !razon_social) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'ruc y razon_social son requeridos.');
  if (!RUC_REGEX.test(ruc)) throw new ApiError(422, 'RUC_INVALIDO', 'El RUC debe tener 11 dígitos.');

  const { rows: rucExistente } = await pool.query('SELECT id FROM companies WHERE ruc = $1', [ruc]);
  if (rucExistente[0]) throw new ApiError(409, 'RUC_EN_USO', 'Ese RUC ya está registrado en Qolqa.');

  const { rows: userRows } = await pool.query('SELECT nombres, apellidos FROM users WHERE id = $1', [req.usuario.id]);
  const usuario = userRows[0];

  const { rows: rolAdminRows } = await pool.query("SELECT id FROM roles WHERE company_id IS NULL AND nombre = 'admin'");
  const rolAdmin = rolAdminRows[0];
  if (!rolAdmin) throw new ApiError(500, 'ROL_ADMIN_NO_SEMBRADO', 'Falta sembrar el rol "admin".');

  const { rows: companyRows } = await pool.query('SELECT crear_empresa($1, $2, $3, $4, $5, $6) AS id', [
    `Cuenta de ${usuario.nombres} ${usuario.apellidos}`,
    req.usuario.id,
    ruc,
    razon_social,
    nombre_comercial || null,
    rolAdmin.id,
  ]);
  const companyId = companyRows[0].id;

  await conContexto({ companyId, userId: req.usuario.id }, async (client) => {
    await auditoria.registrar(client, {
      companyId,
      userId: req.usuario.id,
      accion: 'empresa.crear',
      entidad: 'company',
      entidadId: companyId,
      valorNuevo: { ruc, razon_social },
      ip: req.ip,
    });
  });

  res.status(201).json({ id: companyId, ruc, razon_social });
}

module.exports = { obtenerActiva, actualizar, agregar };
