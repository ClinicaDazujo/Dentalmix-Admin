const express = require('express');
const db = require('../db');
const sucursales = require('../sucursales');
const { enviarCSV, enviarXLSXMultiHoja } = require('../export');
const { MARCAS, SUCURSAL_LABORATORIO } = require('../constants');

const router = express.Router();

const COLUMNAS = [
  { header: 'Negocio', key: 'sucursal', width: 18 },
  { header: 'Ingreso', key: 'ingreso', width: 16 },
  { header: 'Gasto', key: 'gasto', width: 16 },
  { header: 'Utilidad', key: 'utilidad', width: 16 },
  { header: 'Margen', key: 'margen', width: 12 },
];

const r2 = (n) => Math.round(n * 100) / 100;

function mesActual() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

function margenTexto(ingreso, utilidad) {
  return ingreso > 0 ? `${((utilidad / ingreso) * 100).toFixed(1)}%` : '-';
}

function resumenMes(mes, marca) {
  const gastos = db.prepare("SELECT sucursal, monto FROM gastos WHERE substr(fecha, 1, 7) = ? AND marca = ? AND no_gasto = 0").all(mes, marca);
  const ingresos = db.prepare('SELECT sucursal, monto FROM ingresos WHERE mes = ? AND marca = ?').all(mes, marca);

  // Laboratorio no se reparte por clinica (su gasto es unico), asi que se
  // muestra como un solo renglon con el total en vez de tabla por sucursal.
  if (marca === 'laboratorio') {
    const ingreso = ingresos.reduce((s, i) => s + i.monto, 0);
    const gasto = gastos.reduce((s, g) => s + g.monto, 0);
    const utilidad = ingreso - gasto;
    return [{ sucursal: SUCURSAL_LABORATORIO, ingreso, gasto, utilidad, margen: margenTexto(ingreso, utilidad) }];
  }

  // Las sucursales activas cubren los meses futuros; las que ya se dieron de
  // baja se siguen mostrando en los meses donde alcanzaron a tener actividad,
  // para no perder la utilidad historica de ese cierre.
  const nombresSucursales = new Set(sucursales.listarActivas());
  for (const g of gastos) nombresSucursales.add(g.sucursal);
  for (const i of ingresos) nombresSucursales.add(i.sucursal);

  const filas = [...nombresSucursales].map((sucursal) => {
    const ingreso = ingresos.filter((i) => i.sucursal === sucursal).reduce((s, i) => s + i.monto, 0);
    const gasto = gastos.filter((g) => g.sucursal === sucursal).reduce((s, g) => s + g.monto, 0);
    const utilidad = ingreso - gasto;
    return { sucursal, ingreso: r2(ingreso), gasto: r2(gasto), utilidad: r2(utilidad), margen: margenTexto(ingreso, utilidad) };
  });

  const totalIngreso = filas.reduce((s, f) => s + f.ingreso, 0);
  const totalGasto = filas.reduce((s, f) => s + f.gasto, 0);
  const totalUtilidad = totalIngreso - totalGasto;
  filas.push({
    sucursal: 'TOTAL',
    ingreso: r2(totalIngreso),
    gasto: r2(totalGasto),
    utilidad: r2(totalUtilidad),
    margen: margenTexto(totalIngreso, totalUtilidad),
  });

  return filas;
}

function mesValido(valor) {
  return /^\d{4}-\d{2}$/.test(valor) ? valor : mesActual();
}

function marcaValida(valor) {
  return MARCAS.includes(valor) ? valor : 'dentalmix';
}

router.get('/export/csv', (req, res) => {
  const mes = mesValido(req.query.mes);
  const marca = marcaValida(req.query.marca);
  enviarCSV(res, `cierre_${mes}_${marca}`, COLUMNAS, resumenMes(mes, marca));
});

const COLUMNAS_TENDENCIA = [
  { header: 'Mes', key: 'mes', width: 14 },
  { header: 'Ingreso', key: 'ingreso', width: 16 },
  { header: 'Gasto', key: 'gasto', width: 16 },
  { header: 'Utilidad', key: 'utilidad', width: 16 },
];

// POST (no GET) porque va con las imagenes de las graficas ya renderizadas en
// el navegador, que no caben de forma practica en la URL de un enlace normal.
router.post('/export/xlsx', async (req, res) => {
  const mes = mesValido(req.body.mes);
  const marca = marcaValida(req.body.marca);
  const graficas = Array.isArray(req.body.graficas) ? req.body.graficas : [];

  const hojas = [{ nombre: 'Cierre de mes', columnas: COLUMNAS, filas: resumenMes(mes, marca), graficas }];

  const tendencia = req.body.tendencia;
  if (tendencia && Array.isArray(tendencia.filas)) {
    hojas.push({
      nombre: 'Tendencia',
      columnas: COLUMNAS_TENDENCIA,
      filas: tendencia.filas,
      graficas: Array.isArray(tendencia.graficas) ? tendencia.graficas : [],
    });
  }

  await enviarXLSXMultiHoja(res, `cierre_${mes}_${marca}`, hojas);
});

module.exports = router;
