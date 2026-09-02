require('express-async-errors'); // permite `throw` dentro de handlers async sin try/catch manual
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/auth.routes');
const companiesRoutes = require('./routes/companies.routes');
const branchesRoutes = require('./routes/branches.routes');
const usersRoutes = require('./routes/users.routes');
const rolesRoutes = require('./routes/roles.routes');
const auditoriaRoutes = require('./routes/auditoria.routes');
const adminRoutes = require('./routes/admin.routes');
const internalRoutes = require('./routes/internal.routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', true); // para que req.ip sea el real detrás de un proxy/load balancer

app.use(helmet());
app.use(cors());
// 10mb: los comprobantes de pago (internal.routes) viajan en base64 dentro
// del JSON — el límite por defecto de express (100kb) los rechazaría.
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/companies', companiesRoutes);
app.use('/api/v1/branches', branchesRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/roles', rolesRoutes);
app.use('/api/v1/audit-logs', auditoriaRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/internal', internalRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada.' } });
});

app.use(errorHandler);

module.exports = app;
