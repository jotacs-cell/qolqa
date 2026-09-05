const { pool, conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const auditoria = require('../services/auditoria.service');
const kardex = require('../services/kardex.service');

async function listar(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = (page - 1) * limit;
  const { search, estado } = req.query;

  const condiciones = [`company_id = $1`];
  const valores = [req.usuario.companyId];

  if (search) {
    valores.push(`%${search}%`);
    condiciones.push(`(nombre ILIKE $${valores.length} OR codigo_barras ILIKE $${valores.length})`);
  }
  if (estado) {
    valores.push(estado);
    condiciones.push(`estado = $${valores.length}`);
  }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  const { rows: data } = await pool.query(
    `SELECT id, codigo_barras, nombre, descripcion, precio_compra, precio_venta, stock, stock_reservado, (stock - stock_reservado) AS stock_disponible, estado, imagen_url,
            unidad_mayor_nombre, unidad_mayor_codigo_sunat, unidad_mayor_factor, unidad_mayor_precio_venta
     FROM productos ${where}
     ORDER BY nombre
     LIMIT ${limit} OFFSET ${offset}`,
    valores
  );
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM productos ${where}`, valores);
  const total = countRows[0].total;

  res.json({ data, paginacion: { page, limit, total, total_paginas: Math.ceil(total / limit) } });
}

async function obtener(req, res) {
  const { rows } = await pool.query('SELECT * FROM productos WHERE id = $1 AND company_id = $2', [
    req.params.id,
    req.usuario.companyId,
  ]);
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Producto no encontrado.');
  res.json(rows[0]);
}

async function obtenerPorCodigoBarras(req, res) {
  const { rows } = await pool.query('SELECT * FROM productos WHERE codigo_barras = $1 AND company_id = $2', [
    req.params.codigo_barras,
    req.usuario.companyId,
  ]);
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'No hay un producto con ese código de barras.');
  res.json(rows[0]);
}

/**
 * Valida el bloque opcional de unidad mayor (venta por caja/paquete) —
 * ver migración 016_multi_unidad.sql. O las 4 vienen completas, o
 * ninguna: no tiene sentido una caja "a medias". Devuelve los 4 valores
 * listos para el INSERT/UPDATE (null,null,null,null si no aplica).
 */
function validarUnidadMayor({ unidad_mayor_nombre, unidad_mayor_codigo_sunat, unidad_mayor_factor, unidad_mayor_precio_venta }) {
  const campos = [unidad_mayor_nombre, unidad_mayor_codigo_sunat, unidad_mayor_factor, unidad_mayor_precio_venta];
  const algunoPresente = campos.some((c) => c != null && c !== '');
  if (!algunoPresente) return [null, null, null, null];

  if (!unidad_mayor_nombre || !unidad_mayor_codigo_sunat || unidad_mayor_factor == null || unidad_mayor_precio_venta == null) {
    throw new ApiError(
      422, 'UNIDAD_MAYOR_INCOMPLETA',
      'Para vender por unidad mayor debes indicar nombre, código SUNAT, contenido (cuántas unidades menor trae) y precio de venta — o dejar los 4 vacíos.'
    );
  }
  if (!Number.isInteger(Number(unidad_mayor_factor)) || Number(unidad_mayor_factor) <= 1) {
    throw new ApiError(422, 'UNIDAD_MAYOR_FACTOR_INVALIDO', 'El contenido debe ser un entero mayor a 1 (si es 1, no hace falta unidad mayor).');
  }
  if (Number(unidad_mayor_precio_venta) < 0) {
    throw new ApiError(422, 'UNIDAD_MAYOR_PRECIO_INVALIDO', 'El precio de la unidad mayor no puede ser negativo.');
  }
  return [unidad_mayor_nombre, unidad_mayor_codigo_sunat, Number(unidad_mayor_factor), Number(unidad_mayor_precio_venta)];
}

async function crear(req, res) {
  const { codigo_barras = null, nombre, precio_compra, precio_venta, stock = 0, imagen_url = null } = req.body;
  if (!nombre || precio_compra == null || precio_venta == null) {
    throw new ApiError(422, 'DATOS_INCOMPLETOS', 'nombre, precio_compra y precio_venta son requeridos.');
  }
  if (Number(precio_venta) < Number(precio_compra)) {
    throw new ApiError(422, 'MARGEN_INVALIDO', 'precio_venta no puede ser menor a precio_compra.');
  }
  const [umNombre, umCodigo, umFactor, umPrecio] = validarUnidadMayor(req.body);

  try {
    const producto = await conTransaccion(async (client) => {
      // Se crea con stock 0 y, si trae stock inicial, se registra como un
      // movimiento de entrada — así el kardex también explica de dónde
      // salió el stock con el que nace el producto, no solo el que se
      // mueve después.
      const { rows } = await client.query(
        `INSERT INTO productos (
           company_id, codigo_barras, nombre, precio_compra, precio_venta, stock, imagen_url,
           unidad_mayor_nombre, unidad_mayor_codigo_sunat, unidad_mayor_factor, unidad_mayor_precio_venta
         )
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10) RETURNING *`,
        [req.usuario.companyId, codigo_barras, nombre, precio_compra, precio_venta, imagen_url, umNombre, umCodigo, umFactor, umPrecio]
      );
      const nuevo = rows[0];
      if (Number(stock) > 0) {
        const almacenId = await kardex.obtenerAlmacenPrincipal(client, req.usuario.companyId);
        await kardex.registrarMovimiento(client, {
          companyId: req.usuario.companyId, productoId: nuevo.id, almacenId, tipo: 'entrada', cantidad: Number(stock),
          motivo: 'Stock inicial', referenciaTipo: 'producto_creado', referenciaId: nuevo.id, usuarioId: req.usuario.id,
        });
        nuevo.stock = Number(stock);
      }
      return nuevo;
    });

    await auditoria.registrar({
      companyId: req.usuario.companyId,
      usuarioId: req.usuario.id,
      accion: 'producto.crear',
      entidad: 'producto',
      entidadId: producto.id,
      detalle: { codigo_barras, nombre },
    });
    res.status(201).json(producto);
  } catch (err) {
    if (err.code === '23505') throw new ApiError(409, 'CODIGO_DUPLICADO', 'Ese código de barras ya existe.');
    throw err;
  }
}

async function actualizar(req, res) {
  const { nombre, descripcion, precio_compra, precio_venta, imagen_url } = req.body;
  // A diferencia del resto de campos (COALESCE — solo se toca lo que
  // viene en el body), la unidad mayor SIEMPRE se reemplaza por completo
  // con lo que llega: es la única forma de poder QUITARLA (mandando los
  // 4 campos vacíos) una vez configurada.
  const tieneUnidadMayorEnBody = ['unidad_mayor_nombre', 'unidad_mayor_codigo_sunat', 'unidad_mayor_factor', 'unidad_mayor_precio_venta']
    .some((k) => Object.prototype.hasOwnProperty.call(req.body, k));
  const [umNombre, umCodigo, umFactor, umPrecio] = tieneUnidadMayorEnBody ? validarUnidadMayor(req.body) : [undefined, undefined, undefined, undefined];

  const { rows } = await pool.query(
    `UPDATE productos SET
       nombre = COALESCE($1, nombre),
       descripcion = COALESCE($2, descripcion),
       precio_compra = COALESCE($3, precio_compra),
       precio_venta = COALESCE($4, precio_venta),
       imagen_url = COALESCE($5, imagen_url),
       unidad_mayor_nombre = CASE WHEN $8 THEN $6 ELSE unidad_mayor_nombre END,
       unidad_mayor_codigo_sunat = CASE WHEN $8 THEN $9 ELSE unidad_mayor_codigo_sunat END,
       unidad_mayor_factor = CASE WHEN $8 THEN $10 ELSE unidad_mayor_factor END,
       unidad_mayor_precio_venta = CASE WHEN $8 THEN $11 ELSE unidad_mayor_precio_venta END
     WHERE id = $7 AND company_id = $12
     RETURNING *`,
    [nombre, descripcion, precio_compra, precio_venta, imagen_url,
     umNombre, req.params.id, tieneUnidadMayorEnBody, umCodigo, umFactor, umPrecio, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Producto no encontrado.');
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'producto.actualizar',
    entidad: 'producto',
    entidadId: rows[0].id,
    detalle: { nombre, precio_compra, precio_venta },
  });
  res.json(rows[0]);
}

async function cambiarEstado(req, res) {
  const { estado } = req.body;
  if (!['activo', 'inactivo', 'descontinuado'].includes(estado)) {
    throw new ApiError(422, 'ESTADO_INVALIDO', 'estado debe ser activo, inactivo o descontinuado.');
  }
  const { rows } = await pool.query(
    'UPDATE productos SET estado = $1 WHERE id = $2 AND company_id = $3 RETURNING id, estado',
    [estado, req.params.id, req.usuario.companyId]
  );
  if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Producto no encontrado.');
  await auditoria.registrar({
    companyId: req.usuario.companyId,
    usuarioId: req.usuario.id,
    accion: 'producto.cambiar_estado',
    entidad: 'producto',
    entidadId: rows[0].id,
    detalle: { estado },
  });
  res.json(rows[0]);
}

async function ajustarStock(req, res) {
  const { cantidad, motivo } = req.body;
  if (!Number.isInteger(cantidad) || cantidad === 0) {
    throw new ApiError(422, 'CANTIDAD_INVALIDA', 'cantidad debe ser un entero distinto de cero.');
  }

  const resultado = await conTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM productos WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [req.params.id, req.usuario.companyId]
    );
    if (!rows[0]) throw new ApiError(404, 'NO_ENCONTRADO', 'Producto no encontrado.');

    const almacenId = await kardex.obtenerAlmacenPrincipal(client, req.usuario.companyId);
    // El CHECK stock >= 0 (vía kardex.registrarMovimiento) rechaza
    // automáticamente un ajuste que deje stock negativo.
    const { stockResultante } = await kardex.registrarMovimiento(client, {
      companyId: req.usuario.companyId, productoId: rows[0].id, almacenId,
      tipo: cantidad > 0 ? 'ajuste_positivo' : 'ajuste_negativo', cantidad: Math.abs(cantidad),
      motivo: motivo || null, referenciaTipo: 'ajuste_manual', usuarioId: req.usuario.id,
    });
    return { id: rows[0].id, stock: stockResultante };
  });

  res.json({ ...resultado, motivo: motivo || null });
}

module.exports = { listar, obtener, obtenerPorCodigoBarras, crear, actualizar, cambiarEstado, ajustarStock };
