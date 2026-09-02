const { pool } = require('../config/db');

const IGV_TASA = 0.18;

// Por defecto, si no se indica rango: el mes calendario en curso — evita
// que un reporte sin filtros escanee toda la tabla histórica completa
// (el riesgo principal de esta fase es rendimiento al crecer el volumen).
function rangoPorDefecto(desde, hasta) {
  const hoy = new Date();
  return {
    desde: desde || new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10),
    hasta: hasta || hoy.toISOString().slice(0, 10),
  };
}

async function reporteVentas(companyId, desdeIn, hastaIn) {
  const { desde, hasta } = rangoPorDefecto(desdeIn, hastaIn);

  const { rows: totalesRows } = await pool.query(
    `SELECT
        COUNT(*)::int AS cantidad,
        COALESCE(SUM(total) FILTER (WHERE estado_documento != 'anulada'), 0) AS total,
        COUNT(*) FILTER (WHERE estado_documento = 'anulada')::int AS anuladas
       FROM ventas
      WHERE company_id = $1 AND fecha::date BETWEEN $2 AND $3`,
    [companyId, desde, hasta]
  );

  // c.comprobante_afectado_id IS NULL: idem detalle más abajo — sin esto,
  // una venta con una nota de crédito parcial (que no la anula del todo)
  // se contaría dos veces.
  const { rows: porTipo } = await pool.query(
    `SELECT COALESCE(c.tipo_comprobante::text, 'recibo') AS tipo, COUNT(*)::int AS cantidad, COALESCE(SUM(v.total), 0) AS total
       FROM ventas v LEFT JOIN comprobantes_electronicos c ON c.venta_id = v.id AND c.comprobante_afectado_id IS NULL
      WHERE v.company_id = $1 AND v.fecha::date BETWEEN $2 AND $3 AND v.estado_documento != 'anulada'
      GROUP BY 1 ORDER BY total DESC`,
    [companyId, desde, hasta]
  );

  const { rows: porMetodo } = await pool.query(
    `SELECT metodo_pago, COUNT(*)::int AS cantidad, COALESCE(SUM(total), 0) AS total
       FROM ventas
      WHERE company_id = $1 AND fecha::date BETWEEN $2 AND $3 AND estado_documento != 'anulada'
      GROUP BY metodo_pago ORDER BY total DESC`,
    [companyId, desde, hasta]
  );

  // c.comprobante_afectado_id IS NULL: el join solo debe traer el
  // comprobante ORIGINAL de la venta (boleta/factura), nunca una nota de
  // crédito/débito posterior — esas también tienen este mismo venta_id
  // (ver notasCredito.service.js) y duplicarían la fila.
  const { rows: detalle } = await pool.query(
    `SELECT v.id, v.fecha, v.total, v.metodo_pago, v.estado_documento,
            c.tipo_comprobante, c.serie, c.correlativo,
            cl.razon_social_o_nombre AS cliente_nombre
       FROM ventas v
       LEFT JOIN comprobantes_electronicos c ON c.venta_id = v.id AND c.comprobante_afectado_id IS NULL
       LEFT JOIN clientes cl ON cl.id = v.cliente_id
      WHERE v.company_id = $1 AND v.fecha::date BETWEEN $2 AND $3
      ORDER BY v.fecha`,
    [companyId, desde, hasta]
  );

  return {
    periodo: { desde, hasta },
    totales: { cantidad: totalesRows[0].cantidad, total: Number(totalesRows[0].total), anuladas: totalesRows[0].anuladas },
    porTipo: porTipo.map((r) => ({ ...r, total: Number(r.total) })),
    porMetodo: porMetodo.map((r) => ({ ...r, total: Number(r.total) })),
    detalle,
  };
}

async function reporteCompras(companyId, desdeIn, hastaIn) {
  const { desde, hasta } = rangoPorDefecto(desdeIn, hastaIn);

  const { rows: totalesRows } = await pool.query(
    `SELECT
        COUNT(*)::int AS cantidad,
        COALESCE(SUM(total) FILTER (WHERE estado_documento != 'anulada'), 0) AS total,
        COUNT(*) FILTER (WHERE estado_pago = 'pendiente' AND estado_documento != 'anulada')::int AS pendientes
       FROM compras
      WHERE company_id = $1 AND fecha::date BETWEEN $2 AND $3`,
    [companyId, desde, hasta]
  );

  const { rows: porProveedor } = await pool.query(
    `SELECT COALESCE(p.razon_social_o_nombre, 'Sin proveedor') AS proveedor, COUNT(*)::int AS cantidad, COALESCE(SUM(c.total), 0) AS total
       FROM compras c LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.company_id = $1 AND c.fecha::date BETWEEN $2 AND $3 AND c.estado_documento != 'anulada'
      GROUP BY 1 ORDER BY total DESC LIMIT 20`,
    [companyId, desde, hasta]
  );

  const { rows: detalle } = await pool.query(
    `SELECT c.id, c.fecha, c.total, c.numero_factura_proveedor, c.estado_pago, c.estado_documento,
            p.razon_social_o_nombre AS proveedor_nombre
       FROM compras c LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.company_id = $1 AND c.fecha::date BETWEEN $2 AND $3
      ORDER BY c.fecha`,
    [companyId, desde, hasta]
  );

  return {
    periodo: { desde, hasta },
    totales: { cantidad: totalesRows[0].cantidad, total: Number(totalesRows[0].total), pendientes: totalesRows[0].pendientes },
    porProveedor: porProveedor.map((r) => ({ ...r, total: Number(r.total) })),
    detalle,
  };
}

// No hay una columna de "stock mínimo" por producto todavía (Fase 5 no la
// definió) — se usa el mismo umbral fijo que ya muestra Inventario en el
// dashboard (ver renderInventario en el frontend) para que "stock bajo"
// signifique lo mismo en la pantalla y en este reporte.
const UMBRAL_STOCK_BAJO = 5;

/** Snapshot actual — no lleva rango de fechas, el stock siempre es "ahora mismo". */
async function reporteInventario(companyId) {
  const { rows: totalesRows } = await pool.query(
    `SELECT
        COUNT(*)::int AS cantidad_productos,
        COALESCE(SUM(stock), 0)::int AS unidades_totales,
        COALESCE(SUM(stock * precio_compra), 0) AS valorizado_costo,
        COALESCE(SUM(stock * precio_venta), 0) AS valorizado_venta
       FROM productos WHERE company_id = $1 AND estado = 'activo'`,
    [companyId]
  );

  const { rows: stockBajo } = await pool.query(
    `SELECT id, nombre, stock, precio_venta
       FROM productos
      WHERE company_id = $1 AND estado = 'activo' AND stock <= $2
      ORDER BY stock ASC`,
    [companyId, UMBRAL_STOCK_BAJO]
  );

  const { rows: detalle } = await pool.query(
    `SELECT id, codigo_barras, nombre, stock, stock_reservado, precio_compra, precio_venta,
            (stock * precio_compra) AS valor_costo, (stock * precio_venta) AS valor_venta
       FROM productos
      WHERE company_id = $1 AND estado = 'activo'
      ORDER BY nombre`,
    [companyId]
  );

  return {
    totales: {
      cantidadProductos: totalesRows[0].cantidad_productos,
      unidadesTotales: totalesRows[0].unidades_totales,
      valorizadoCosto: Number(totalesRows[0].valorizado_costo),
      valorizadoVenta: Number(totalesRows[0].valorizado_venta),
    },
    stockBajo,
    detalle,
  };
}

/** IGV cobrado (ventas con comprobante SUNAT) vs IGV pagado (compras) del período — para la declaración mensual. */
async function reporteIgv(companyId, desdeIn, hastaIn) {
  const { desde, hasta } = rangoPorDefecto(desdeIn, hastaIn);

  const { rows: ventasIgv } = await pool.query(
    `SELECT COALESCE(SUM(c.operacion_gravada), 0) AS gravada, COALESCE(SUM(c.igv), 0) AS igv, COUNT(*)::int AS cantidad
       FROM comprobantes_electronicos c
       JOIN ventas v ON v.id = c.venta_id
      WHERE c.company_id = $1 AND v.fecha::date BETWEEN $2 AND $3
        AND c.tipo_comprobante IN ('factura', 'boleta') AND v.estado_documento != 'anulada'`,
    [companyId, desde, hasta]
  );

  // Las compras no descomponen IGV en su propia tabla (el comprobante lo
  // emite el proveedor, ver migración 007) — se estima con la misma
  // tasa, igual que hace el PDF de ventas al mostrar "Op. Gravada"/IGV.
  const { rows: comprasRows } = await pool.query(
    `SELECT COALESCE(SUM(total), 0) AS total
       FROM compras WHERE company_id = $1 AND fecha::date BETWEEN $2 AND $3 AND estado_documento != 'anulada'`,
    [companyId, desde, hasta]
  );
  const comprasTotal = Number(comprasRows[0].total);
  const comprasGravada = Number((comprasTotal / (1 + IGV_TASA)).toFixed(2));
  const comprasIgv = Number((comprasTotal - comprasGravada).toFixed(2));

  const igvVentas = Number(ventasIgv[0].igv);
  const igvCompras = comprasIgv;

  return {
    periodo: { desde, hasta },
    ventas: { gravada: Number(ventasIgv[0].gravada), igv: igvVentas, cantidad: ventasIgv[0].cantidad },
    compras: { gravada: comprasGravada, igv: igvCompras, total: comprasTotal },
    igvAPagar: Number((igvVentas - igvCompras).toFixed(2)),
  };
}

module.exports = { reporteVentas, reporteCompras, reporteInventario, reporteIgv };
