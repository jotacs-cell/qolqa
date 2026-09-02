const { conContexto } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');

async function listar(req, res) {
  const sucursales = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('SELECT * FROM branches ORDER BY creado_en');
    return rows;
  });
  res.json(sucursales);
}

async function crear(req, res) {
  const { nombre, ubigeo, direccion } = req.body;
  if (!nombre) throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre es requerido.');

  const sucursal = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO branches (company_id, nombre, ubigeo, direccion) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.usuario.companyId, nombre, ubigeo || null, direccion || null]
    );
    await auditoria.registrar(client, {
      companyId: req.usuario.companyId,
      userId: req.usuario.id,
      accion: 'sucursal.crear',
      entidad: 'branch',
      entidadId: rows[0].id,
      valorNuevo: { nombre },
      ip: req.ip,
    });
    return rows[0];
  });

  res.status(201).json(sucursal);
}

async function cambiarEstado(req, res) {
  const { activa } = req.body;
  if (typeof activa !== 'boolean') throw new ApiError(422, 'DATOS_INCOMPLETOS', 'activa debe ser true o false.');

  const sucursal = await conContexto({ companyId: req.usuario.companyId, userId: req.usuario.id }, async (client) => {
    const { rows } = await client.query('UPDATE branches SET activa = $1 WHERE id = $2 RETURNING *', [activa, req.params.id]);
    if (rows[0]) {
      await auditoria.registrar(client, {
        companyId: req.usuario.companyId,
        userId: req.usuario.id,
        accion: activa ? 'sucursal.reactivar' : 'sucursal.desactivar',
        entidad: 'branch',
        entidadId: rows[0].id,
        ip: req.ip,
      });
    }
    return rows[0];
  });

  if (!sucursal) throw new ApiError(404, 'NO_ENCONTRADA', 'Sucursal no encontrada.');
  res.json(sucursal);
}

module.exports = { listar, crear, cambiarEstado };
