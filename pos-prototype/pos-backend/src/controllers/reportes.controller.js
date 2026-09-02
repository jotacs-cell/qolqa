const ApiError = require('../utils/ApiError');
const reportesService = require('../services/reportes.service');
const { generarCsv, generarXlsx, generarPdf } = require('../services/reportes.export');
const { pool } = require('../config/db');

function money(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function nombreEmpresa(companyId) {
  const { rows } = await pool.query('SELECT razon_social, nombre_comercial FROM empresas WHERE id = $1', [companyId]);
  return (rows[0] && (rows[0].nombre_comercial || rows[0].razon_social)) || 'FacturaPOS';
}

/** Convierte cada reporte a la forma genérica { titulo, columnas, filas } que ya entienden los 3 exportadores. */
function tablasVentas(r) {
  return [
    {
      titulo: 'Resumen',
      columnas: [{ clave: 'k', encabezado: 'Indicador' }, { clave: 'v', encabezado: 'Valor' }],
      filas: [
        { k: 'Cantidad de ventas', v: r.totales.cantidad },
        { k: 'Total vendido', v: money(r.totales.total) },
        { k: 'Ventas anuladas', v: r.totales.anuladas },
      ],
    },
    {
      titulo: 'Por tipo de comprobante',
      columnas: [{ clave: 'tipo', encabezado: 'Tipo' }, { clave: 'cantidad', encabezado: 'Cantidad' }, { clave: 'total', encabezado: 'Total' }],
      filas: r.porTipo.map((x) => ({ tipo: x.tipo, cantidad: x.cantidad, total: money(x.total) })),
    },
    {
      titulo: 'Por método de pago',
      columnas: [{ clave: 'metodo_pago', encabezado: 'Método' }, { clave: 'cantidad', encabezado: 'Cantidad' }, { clave: 'total', encabezado: 'Total' }],
      filas: r.porMetodo.map((x) => ({ metodo_pago: x.metodo_pago, cantidad: x.cantidad, total: money(x.total) })),
    },
    {
      titulo: 'Detalle',
      columnas: [
        { clave: 'fecha', encabezado: 'Fecha' }, { clave: 'documento', encabezado: 'Documento' },
        { clave: 'cliente', encabezado: 'Cliente' }, { clave: 'estado', encabezado: 'Estado' }, { clave: 'total', encabezado: 'Total' },
      ],
      filas: r.detalle.map((v) => ({
        fecha: new Date(v.fecha).toLocaleString('es-PE'),
        documento: v.serie ? `${v.serie}-${String(v.correlativo).padStart(6, '0')}` : `REC-${String(v.id).padStart(6, '0')}`,
        cliente: v.cliente_nombre || 'Cliente varios',
        estado: v.estado_documento === 'anulada' ? 'Anulada' : 'Emitida',
        total: money(v.total),
      })),
    },
  ];
}

function tablasCompras(r) {
  return [
    {
      titulo: 'Resumen',
      columnas: [{ clave: 'k', encabezado: 'Indicador' }, { clave: 'v', encabezado: 'Valor' }],
      filas: [
        { k: 'Cantidad de compras', v: r.totales.cantidad },
        { k: 'Total comprado', v: money(r.totales.total) },
        { k: 'Pendientes de pago', v: r.totales.pendientes },
      ],
    },
    {
      titulo: 'Por proveedor',
      columnas: [{ clave: 'proveedor', encabezado: 'Proveedor' }, { clave: 'cantidad', encabezado: 'Cantidad' }, { clave: 'total', encabezado: 'Total' }],
      filas: r.porProveedor.map((x) => ({ proveedor: x.proveedor, cantidad: x.cantidad, total: money(x.total) })),
    },
    {
      titulo: 'Detalle',
      columnas: [
        { clave: 'fecha', encabezado: 'Fecha' }, { clave: 'proveedor', encabezado: 'Proveedor' },
        { clave: 'factura', encabezado: 'Factura proveedor' }, { clave: 'pago', encabezado: 'Pago' }, { clave: 'total', encabezado: 'Total' },
      ],
      filas: r.detalle.map((c) => ({
        fecha: new Date(c.fecha).toLocaleString('es-PE'),
        proveedor: c.proveedor_nombre || 'Sin proveedor',
        factura: c.numero_factura_proveedor || '—',
        pago: c.estado_documento === 'anulada' ? 'Anulada' : c.estado_pago === 'pagada' ? 'Pagada' : 'Pendiente',
        total: money(c.total),
      })),
    },
  ];
}

function tablasInventario(r) {
  return [
    {
      titulo: 'Resumen',
      columnas: [{ clave: 'k', encabezado: 'Indicador' }, { clave: 'v', encabezado: 'Valor' }],
      filas: [
        { k: 'Productos activos', v: r.totales.cantidadProductos },
        { k: 'Unidades totales', v: r.totales.unidadesTotales },
        { k: 'Valorizado a costo', v: money(r.totales.valorizadoCosto) },
        { k: 'Valorizado a venta', v: money(r.totales.valorizadoVenta) },
      ],
    },
    {
      titulo: 'Stock bajo',
      columnas: [{ clave: 'nombre', encabezado: 'Producto' }, { clave: 'stock', encabezado: 'Stock' }, { clave: 'precio_venta', encabezado: 'Precio venta' }],
      filas: r.stockBajo.map((p) => ({ nombre: p.nombre, stock: p.stock, precio_venta: money(p.precio_venta) })),
    },
    {
      titulo: 'Detalle',
      columnas: [
        { clave: 'nombre', encabezado: 'Producto' }, { clave: 'codigo', encabezado: 'Código' }, { clave: 'stock', encabezado: 'Stock' },
        { clave: 'reservado', encabezado: 'Reservado' }, { clave: 'costo', encabezado: 'Valor a costo' }, { clave: 'venta', encabezado: 'Valor a venta' },
      ],
      filas: r.detalle.map((p) => ({
        nombre: p.nombre, codigo: p.codigo_barras || '—', stock: p.stock, reservado: p.stock_reservado,
        costo: money(p.valor_costo), venta: money(p.valor_venta),
      })),
    },
  ];
}

function tablasIgv(r) {
  return [
    {
      titulo: 'IGV del período',
      columnas: [{ clave: 'k', encabezado: 'Indicador' }, { clave: 'v', encabezado: 'Valor' }],
      filas: [
        { k: 'Ventas gravadas', v: money(r.ventas.gravada) },
        { k: 'IGV de ventas (débito fiscal)', v: money(r.ventas.igv) },
        { k: 'Compras gravadas (estimado)', v: money(r.compras.gravada) },
        { k: 'IGV de compras (crédito fiscal, estimado)', v: money(r.compras.igv) },
        { k: 'IGV a pagar', v: money(r.igvAPagar) },
      ],
    },
  ];
}

const REPORTES = {
  ventas: { obtener: reportesService.reporteVentas, tablas: tablasVentas, titulo: 'Reporte de Ventas' },
  compras: { obtener: reportesService.reporteCompras, tablas: tablasCompras, titulo: 'Reporte de Compras' },
  inventario: { obtener: (companyId) => reportesService.reporteInventario(companyId), tablas: tablasInventario, titulo: 'Reporte de Inventario' },
  igv: { obtener: reportesService.reporteIgv, tablas: tablasIgv, titulo: 'Reporte de IGV' },
};

async function generar(req, res) {
  const tipo = req.params.tipo;
  const def = REPORTES[tipo];
  if (!def) throw new ApiError(404, 'REPORTE_INVALIDO', `Reporte "${tipo}" no existe. Usa: ${Object.keys(REPORTES).join(', ')}.`);

  const { desde, hasta, formato } = req.query;
  const datos = tipo === 'inventario' ? await def.obtener(req.usuario.companyId) : await def.obtener(req.usuario.companyId, desde, hasta);

  if (!formato || formato === 'json') {
    return res.json(datos);
  }

  const tablas = def.tablas(datos);
  const empresa = await nombreEmpresa(req.usuario.companyId);
  const subtitulo = datos.periodo ? `Del ${datos.periodo.desde} al ${datos.periodo.hasta}` : `Al ${new Date().toLocaleDateString('es-PE')}`;
  const nombreArchivo = `${tipo}-${new Date().toISOString().slice(0, 10)}`;

  if (formato === 'csv') {
    const csv = generarCsv(tablas);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${nombreArchivo}.csv"`);
    return res.send(csv);
  }
  if (formato === 'xlsx') {
    const buffer = await generarXlsx(def.titulo, tablas);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${nombreArchivo}.xlsx"`);
    return res.send(buffer);
  }
  if (formato === 'pdf') {
    const buffer = await generarPdf(empresa, def.titulo, subtitulo, tablas);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${nombreArchivo}.pdf"`);
    return res.send(buffer);
  }
  throw new ApiError(422, 'FORMATO_INVALIDO', 'formato debe ser json, csv, xlsx o pdf.');
}

module.exports = { generar };
