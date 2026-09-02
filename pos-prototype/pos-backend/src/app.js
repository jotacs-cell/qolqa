require('express-async-errors'); // permite `throw` dentro de handlers async sin try/catch manual
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth.routes');
const empresasRoutes = require('./routes/empresas.routes');
const productosRoutes = require('./routes/productos.routes');
const clientesRoutes = require('./routes/clientes.routes');
const cotizacionesRoutes = require('./routes/cotizaciones.routes');
const pedidosRoutes = require('./routes/pedidos.routes');
const almacenesRoutes = require('./routes/almacenes.routes');
const kardexRoutes = require('./routes/kardex.routes');
const transferenciasRoutes = require('./routes/transferencias.routes');
const proveedoresRoutes = require('./routes/proveedores.routes');
const comprasRoutes = require('./routes/compras.routes');
const ordenesCompraRoutes = require('./routes/ordenesCompra.routes');
const cajaRoutes = require('./routes/caja.routes');
const reportesRoutes = require('./routes/reportes.routes');
const oportunidadesRoutes = require('./routes/oportunidades.routes');
const ventasRoutes = require('./routes/ventas.routes');
const comprobantesRoutes = require('./routes/comprobantes.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const adminRoutes = require('./routes/admin.routes');
const catalogoRoutes = require('./routes/catalogo.routes');
const cuentasBancariasRoutes = require('./routes/cuentasBancarias.routes');

const app = express();

app.use(helmet());
app.use(cors());
// 10mb: los comprobantes de pago (POST /empresas/mi-empresa/comprobantes-pago)
// viajan en base64 dentro del JSON — el límite por defecto (100kb) los rechazaría.
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/cotizaciones', cotizacionesRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/almacenes', almacenesRoutes);
app.use('/api/kardex', kardexRoutes);
app.use('/api/transferencias', transferenciasRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/compras', comprasRoutes);
app.use('/api/ordenes-compra', ordenesCompraRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/oportunidades', oportunidadesRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/comprobantes', comprobantesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/cuentas-bancarias', cuentasBancariasRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada.' } });
});

// Manejador de errores centralizado (debe ir al final, con 4 argumentos)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: {
      codigo: err.codigo || 'ERROR_INTERNO',
      mensaje: status === 500 ? 'Error interno del servidor.' : err.message,
      detalle: err.detalle,
    },
  });
});

module.exports = app;
