const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');

/**
 * Catálogo virtual público — sin autenticación, a propósito: lo ve
 * cualquier persona con el link, nunca un usuario logueado del sistema.
 * Solo lectura, sin carrito ni checkout — el "pedido" se hace por
 * WhatsApp (catalogo_whatsapp), no queda registrado en `pedidos`.
 */
async function obtenerPublico(req, res) {
  const { rows: empresaRows } = await pool.query(
    `SELECT id, razon_social, nombre_comercial, catalogo_whatsapp
       FROM empresas WHERE catalogo_slug = $1 AND activa`,
    [req.params.slug]
  );
  const empresa = empresaRows[0];
  if (!empresa) {
    throw new ApiError(404, 'CATALOGO_NO_ENCONTRADO', 'No existe un catálogo público con esa dirección.');
  }

  const { rows: productos } = await pool.query(
    `SELECT id, nombre, descripcion, precio_venta, imagen_url,
            GREATEST(stock - stock_reservado, 0) AS stock_disponible
       FROM productos
      WHERE company_id = $1 AND estado = 'activo'
      ORDER BY nombre`,
    [empresa.id]
  );

  res.json({
    empresa: {
      nombre: empresa.nombre_comercial || empresa.razon_social,
      whatsapp: empresa.catalogo_whatsapp,
    },
    productos,
  });
}

module.exports = { obtenerPublico };
