const express = require('express');
const db = require('../db');
const { METAS_MENSUALES } = require('../constants');
const sucursales = require('../sucursales');
const { enviarCSV, enviarXLSX } = require('../export');

const router = express.Router();

const COLUMNAS = [
  { header: 'Mes', key: 'mes', width: 14 },
  { header: 'Ingreso', key: 'ingreso', width: 16 },
  { header: 'Gasto', key: 'gasto', width: 16 },
  { header: 'Utilidad', key: 'utilidad', width: 16 },
  { header: 'Meta', key: 'meta', width: 14 },
  { header: '% Cumplido', key: 'pctCumplido', width: 14 },
];

function mesActual() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

function mesSiguiente(mes) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rangoMeses(mesInicio, mesFin) {
  let inicio = /^\d{4}-\d{2}$/.test(mesInicio) ? mesInicio : mesActual();
  let fin = /^\d{4}-\d{2}$/.test(mesFin) ? mesFin : mesActual();
  if (inicio > fin) [inicio, fin] = [fin, inicio];

  const meses = [];
  let actual = inicio;
  let tope = 0;
  while (actual <= fin && tope < 240) {
    meses.push(actual);
    actual = mesSiguiente(actual);
    tope++;
  }
  return meses;
}

function nombreMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
}

function datosProyeccion(sucursal, desde, hasta) {
  const meses = rangoMeses(desde, hasta);
  const meta = METAS_MENSUALES[sucursal] || null;

  return meses.map((mes) => {
    const ingreso = db
      .prepare('SELECT COALESCE(SUM(monto), 0) AS total FROM ingresos WHERE sucursal = ? AND mes = ?')
      .get(sucursal, mes).total;
    const gasto = db
      .prepare("SELECT COALESCE(SUM(monto), 0) AS total FROM gastos WHERE sucursal = ? AND substr(fecha, 1, 7) = ? AND no_gasto = 0")
      .get(sucursal, mes).total;
    const utilidad = ingreso - gasto;
    const pctCumplido = meta ? `${((ingreso / meta) * 100).toFixed(1)}%` : '-';

    return {
      mes: nombreMes(mes),
      ingreso,
      gasto,
      utilidad,
      meta: meta || '-',
      pctCumplido,
    };
  });
}

router.get('/export/csv', (req, res) => {
  const activas = sucursales.listarActivas();
  const sucursal = activas.includes(req.query.sucursal) ? req.query.sucursal : activas[0];
  const filas = datosProyeccion(sucursal, req.query.desde, req.query.hasta);
  enviarCSV(res, `proyeccion_${sucursal}`, COLUMNAS, filas);
});

router.post('/export/xlsx', async (req, res) => {
  const activas = sucursales.listarActivas();
  const sucursal = activas.includes(req.body.sucursal) ? req.body.sucursal : activas[0];
  const filas = datosProyeccion(sucursal, req.body.desde, req.body.hasta);
  const graficas = Array.isArray(req.body.graficas) ? req.body.graficas : [];
  await enviarXLSX(res, `proyeccion_${sucursal}`, 'Proyeccion mensual', COLUMNAS, filas, graficas);
});

module.exports = router;
