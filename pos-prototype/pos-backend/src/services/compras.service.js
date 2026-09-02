const { conTransaccion } = require('../config/db');
const ApiError = require('../utils/ApiError');
const kardex = require('./kardex.service');

/**
 * Registra una compra completa dentro de una única transacción SQL —
 * simétrico a ventas.service.js#registrarVenta, pero la mercadería entra
 * en vez de salir (kardex 'entrada') y no hay ningún comprobante propio
 * que reservar/emitir: el que vale es el que emite el proveedor, acá solo
 * se guarda su número de referencia.
 */
async function registrarCompra({ companyId, usuarioId, proveedorId, numeroFacturaProveedor, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(422, 'CARRITO_VACIO', 'La compra debe tener al menos un ítem.');
  }

  return conTransaccion(async (client) => {
    let total = 0;
    const lineas = [];

    for (const item of items) {
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
        throw new ApiError(422, 'CANTIDAD_INVALIDA', `Cantidad inválida para el producto ${item.producto_id}.`);
      }
      if (!(Number(item.precio_unitario) >= 0)) {
        throw new ApiError(422, 'PRECIO_INVALIDO', `precio_unitario inválido para el producto ${item.producto_id}.`);
      }

      const { rows } = await client.query('SELECT id FROM productos WHERE id = $1 AND company_id = $2 FOR UPDATE', [
        item.producto_id,
        companyId,
      ]);
      const producto = rows[0];
      if (!producto) {
        throw new ApiError(422, 'PRODUCTO_INEXISTENTE', `El producto ${item.producto_id} no existe.`);
      }

      const precioUnitario = Number(item.precio_unitario);
      const subtotal = Number((precioUnitario * item.cantidad).toFixed(2));
      total += subtotal;

      lineas.push({ productoId: producto.id, cantidad: item.cantidad, precioUnitario, subtotal });
    }
    total = Number(total.toFixed(2));

    const { rows: compraRows } = await client.query(
      `INSERT INTO compras (company_id, usuario_id, proveedor_id, numero_factura_proveedor, total)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, fecha`,
      [companyId, usuarioId, proveedorId || null, numeroFacturaProveedor || null, total]
    );
    const compra = compraRows[0];

    const almacenId = await kardex.obtenerAlmacenPrincipal(client, companyId);
    for (const linea of lineas) {
      await client.query(
        `INSERT INTO detalle_compras (compra_id, producto_id, cantidad, precio_unitario_historico, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [compra.id, linea.productoId, linea.cantidad, linea.precioUnitario, linea.subtotal]
      );
      // La mercadería entra — el precio de compra NO toca productos.
      // precio_venta (eso lo decide el negocio aparte, en Inventario).
      await kardex.registrarMovimiento(client, {
        companyId, productoId: linea.productoId, almacenId, tipo: 'entrada', cantidad: linea.cantidad,
        referenciaTipo: 'compra', referenciaId: compra.id, usuarioId,
      });
    }

    return { compra: { id: compra.id, fecha: compra.fecha, total, items: lineas } };
  });
}

module.exports = { registrarCompra };
