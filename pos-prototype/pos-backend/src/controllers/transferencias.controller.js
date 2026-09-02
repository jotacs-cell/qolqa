const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const kardex = require('../services/kardex.service');
const auditoria = require('../services/auditoria.service');

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT t.id, t.producto_id, p.nombre AS producto_nombre,
            t.almacen_origen_id, ao.nombre AS almacen_origen_nombre,
            t.almacen_destino_id, ad.nombre AS almacen_destino_nombre,
            t.cantidad, t.motivo, t.creado_en
       FROM transferencias t
       JOIN productos p ON p.id = t.producto_id
       JOIN almacenes ao ON ao.id = t.almacen_origen_id
       JOIN almacenes ad ON ad.id = t.almacen_destino_id
      WHERE t.company_id = $1
      ORDER BY t.creado_en DESC
      LIMIT 100`,
    [req.usuario.companyId]
  );
  res.json({ data: rows });
}

/**
 * Mueve stock de un almacén a otro de la misma empresa: no cambia el
 * total de la empresa, solo lo redistribuye — genera dos movimientos de
 * kardex (salida del origen, entrada al destino) referenciando esta
 * transferencia.
 */
async function crear(req, res) {
  const { producto_id, almacen_origen_id, almacen_destino_id, cantidad, motivo } = req.body;
  if (!producto_id || !almacen_origen_id || !almacen_destino_id || !cantidad) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'producto_id, almacen_origen_id, almacen_destino_id y cantidad son requeridos.');
  }
  if (String(almacen_origen_id) === String(almacen_destino_id)) {
    throw new ApiError(422, 'ALMACENES_IGUALES', 'El almacén de origen y destino no pueden ser el mismo.');
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new ApiError(422, 'CANTIDAD_INVALIDA', 'cantidad debe ser un entero mayor a cero.');
  }

  const resultado = await conTransaccion(async (client) => {
    // Ambos almacenes deben ser de esta empresa — evita mover stock entre empresas distintas.
    const { rows: almacenes } = await client.query(
      'SELECT id FROM almacenes WHERE company_id = $1 AND id IN ($2, $3)',
      [req.usuario.companyId, almacen_origen_id, almacen_destino_id]
    );
    if (almacenes.length !== 2) {
      throw new ApiError(404, 'ALMACEN_NO_ENCONTRADO', 'Uno de los almacenes no existe en esta empresa.');
    }

    const { rows: transRows } = await client.query(
      `INSERT INTO transferencias (company_id, producto_id, almacen_origen_id, almacen_destino_id, cantidad, motivo, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.usuario.companyId, producto_id, almacen_origen_id, almacen_destino_id, cantidad, motivo || null, req.usuario.id]
    );
    const transferenciaId = transRows[0].id;

    await kardex.registrarMovimiento(client, {
      companyId: req.usuario.companyId, productoId: producto_id, almacenId: almacen_origen_id, tipo: 'transferencia_salida', cantidad,
      motivo: motivo || null, referenciaTipo: 'transferencia', referenciaId: transferenciaId, usuarioId: req.usuario.id,
    });
    await kardex.registrarMovimiento(client, {
      companyId: req.usuario.companyId, productoId: producto_id, almacenId: almacen_destino_id, tipo: 'transferencia_entrada', cantidad,
      motivo: motivo || null, referenciaTipo: 'transferencia', referenciaId: transferenciaId, usuarioId: req.usuario.id,
    });

    return { id: transferenciaId };
  });

  await auditoria.registrar({
    companyId: req.usuario.companyId, usuarioId: req.usuario.id,
    accion: 'transferencia.crear', entidad: 'transferencia', entidadId: resultado.id,
    detalle: { producto_id, almacen_origen_id, almacen_destino_id, cantidad },
  });

  res.status(201).json(resultado);
}

module.exports = { listar, crear };
