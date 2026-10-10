require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cuentasRouter = require('./routes/cuentas');
const gastosRouter = require('./routes/gastos');
const ingresosRouter = require('./routes/ingresos');
const ventasRouter = require('./routes/ventas');
const cajaRouter = require('./routes/caja');
const cierreRouter = require('./routes/cierre');
const proyeccionRouter = require('./routes/proyeccion');
const authRouter = require('./routes/auth');
const usuariosRouter = require('./routes/usuarios');
const { RUBROS, NO_GASTO_RUBROS, FORMAS_PAGO, METAS_MENSUALES, TOMOX_SUCURSALES, SUCURSAL_LABORATORIO } = require('./constants');
const sucursales = require('./sucursales');
const { requireAuth, requireAdmin } = require('./auth');
const { iniciarCron } = require('./cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway (y la mayoria de hosts) ponen la app detras de un proxy; esto permite
// que req.ip refleje la IP real del visitante en vez de la del proxy interno.
app.set('trust proxy', true);

// Limite alto porque los exports de Excel con graficas mandan varias imagenes
// en base64 dentro del JSON (el default de 100kb se queda corto).
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// Evita que el navegador guarde en cache (disco o bfcache) las paginas y
// respuestas de la app: sin esto, alguien podria usar "atras" o el historial
// en una computadora compartida y ver datos de una sesion ya cerrada.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', authRouter);

app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    sucursales: sucursales.listarActivas(),
    metasMensuales: METAS_MENSUALES,
    rubros: RUBROS,
    noGastoRubros: NO_GASTO_RUBROS,
    formasPago: FORMAS_PAGO,
    tomoxSucursales: TOMOX_SUCURSALES,
    sucursalLaboratorio: SUCURSAL_LABORATORIO,
  });
});

app.use('/api/cuentas', requireAuth, cuentasRouter);
app.use('/api/gastos', requireAuth, gastosRouter);
app.use('/api/ingresos', requireAuth, ingresosRouter);
app.use('/api/ventas', requireAuth, ventasRouter);
app.use('/api/caja', requireAuth, cajaRouter);
app.use('/api/cierre', requireAuth, cierreRouter);
app.use('/api/proyeccion', requireAuth, proyeccionRouter);
app.use('/api/usuarios', requireAuth, requireAdmin, usuariosRouter);

app.listen(PORT, () => {
  console.log(`Servidor de Dentalmix corriendo en http://localhost:${PORT}`);
  iniciarCron();
});
