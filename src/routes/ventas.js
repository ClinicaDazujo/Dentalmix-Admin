const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const db = require('../db');
const { SUCURSAL_UNICA, COMISION_PCT } = require('../constants');
const { enviarCSV } = require('../export');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CAMPOS = ['efectivo', 'tarjeta', 'transferencia', 'credito', 'vales'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function mesValido(m) {
  return /^\d{4}-\d{2}$/.test(m || '') ? m : null;
}

// Mantiene la tabla de ingresos (que usan Cierre de Mes y Proyeccion) igual al total de ventas del mes.
function sincronizarIngreso(mes) {
  const t = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(efectivo + tarjeta + transferencia + credito + vales), 0) AS total
       FROM ventas_dia WHERE substr(fecha, 1, 7) = ?`
    )
    .get(mes);
  db.prepare("DELETE FROM ingresos WHERE sucursal = ? AND mes = ? AND marca = 'dentalmix'").run(SUCURSAL_UNICA, mes);
  if (t.n > 0) {
    db.prepare("INSERT INTO ingresos (sucursal, mes, monto, concepto, marca) VALUES (?, ?, ?, 'Ventas SICAR', 'dentalmix')").run(
      SUCURSAL_UNICA,
      mes,
      r2(t.total)
    );
  }
}

function resumenVentas(mes) {
  const filas = db.prepare('SELECT * FROM ventas_dia WHERE substr(fecha, 1, 7) = ? ORDER BY fecha').all(mes);
  const tot = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0, vales: 0 };
  for (const f of filas) {
    f.total = r2(CAMPOS.reduce((s, c) => s + f[c], 0));
    f.comisionable = r2(f.efectivo + f.tarjeta + f.transferencia);
    f.comision = r2(f.comisionable * COMISION_PCT);
    for (const c of CAMPOS) tot[c] += f[c];
  }
  for (const c of CAMPOS) tot[c] = r2(tot[c]);
  const total = r2(CAMPOS.reduce((s, c) => s + tot[c], 0));
  const comisionable = r2(tot.efectivo + tot.tarjeta + tot.transferencia);
  return {
    mes,
    filas,
    totales: { ...tot, total },
    comision: { pct: COMISION_PCT, base: comisionable, excluido_credito: tot.credito, importe: r2(comisionable * COMISION_PCT) },
  };
}

router.get('/', (req, res) => {
  const mes = mesValido(req.query.mes);
  if (!mes) return res.status(400).json({ error: 'Mes invalido, usa AAAA-MM' });
  res.json(resumenVentas(mes));
});

router.put('/:fecha', (req, res) => {
  const { fecha } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha invalida' });
  const v = {};
  for (const c of CAMPOS) {
    const n = req.body[c] === undefined || req.body[c] === '' ? 0 : Number(req.body[c]);
    if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: `Valor invalido en ${c}` });
    v[c] = r2(n);
  }
  db.prepare(
    `INSERT INTO ventas_dia (fecha, efectivo, tarjeta, transferencia, credito, vales, fuente, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'captura', datetime('now'))
     ON CONFLICT(fecha) DO UPDATE SET efectivo = excluded.efectivo, tarjeta = excluded.tarjeta, transferencia = excluded.transferencia,
       credito = excluded.credito, vales = excluded.vales, fuente = 'captura', updated_at = datetime('now')`
  ).run(fecha, v.efectivo, v.tarjeta, v.transferencia, v.credito, v.vales);
  sincronizarIngreso(fecha.slice(0, 7));
  res.json(resumenVentas(fecha.slice(0, 7)));
});

router.delete('/:fecha', (req, res) => {
  const info = db.prepare('DELETE FROM ventas_dia WHERE fecha = ?').run(req.params.fecha);
  if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  sincronizarIngreso(req.params.fecha.slice(0, 7));
  res.status(204).end();
});

function valorCelda(c) {
  const v = c?.value;
  if (v && typeof v === 'object' && 'result' in v) return v.result;
  if (v && typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  return v;
}
function aFecha(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// Acepta el reporte "INGRESOS POR METODO DE PAGO" (una hoja por mes) o el "Corte diario por forma de pago" de SICAR.
// Busca el renglon de encabezados (EFECTIVO / TARJETA / TRANSFERENCIA / CREDITO) y toma cada renglon con fecha.
router.post('/importar', upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
  const mesFiltro = mesValido(req.body.mes);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'No se pudo leer el archivo. Debe ser .xlsx' });
  }

  const dias = new Map();
  for (const ws of wb.worksheets) {
    let mapa = null;
    let colFecha = null;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (!mapa) {
        const m = {};
        row.eachCell((cell, col) => {
          const t = norm(valorCelda(cell));
          if (t === 'EFECTIVO') m.efectivo = col;
          else if (t === 'TARJETA') m.tarjeta = col;
          else if (t === 'TRANSFERENCIA') m.transferencia = col;
          else if (t === 'CREDITO') m.credito = col;
          else if (t === 'VALES') m.vales = col;
          else if (t === 'FECHA' || t === 'DIA') colFecha = colFecha ?? col;
        });
        if (m.efectivo && m.tarjeta && m.credito) mapa = m;
        return;
      }
      let fecha = null;
      row.eachCell((cell) => {
        if (!fecha) fecha = aFecha(valorCelda(cell));
      });
      if (!fecha) return;
      const reg = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0, vales: 0 };
      for (const c of CAMPOS) if (mapa[c]) reg[c] = r2(Number(valorCelda(row.getCell(mapa[c]))) || 0);
      dias.set(fecha, reg);
    });
  }

  const lista = [...dias.entries()].filter(([f]) => !mesFiltro || f.startsWith(mesFiltro));
  if (!lista.length) return res.status(400).json({ error: 'No encontre renglones con fecha y columnas EFECTIVO, TARJETA, TRANSFERENCIA y CREDITO' });

  const upsert = db.prepare(
    `INSERT INTO ventas_dia (fecha, efectivo, tarjeta, transferencia, credito, vales, fuente, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'importacion', datetime('now'))
     ON CONFLICT(fecha) DO UPDATE SET efectivo = excluded.efectivo, tarjeta = excluded.tarjeta, transferencia = excluded.transferencia,
       credito = excluded.credito, vales = excluded.vales, fuente = 'importacion', updated_at = datetime('now')`
  );
  const meses = new Set();
  for (const [f, v] of lista) {
    upsert.run(f, v.efectivo, v.tarjeta, v.transferencia, v.credito, v.vales);
    meses.add(f.slice(0, 7));
  }
  meses.forEach(sincronizarIngreso);
  res.json({ importados: lista.length, meses: [...meses].sort() });
});

router.get('/export/csv', (req, res) => {
  const mes = mesValido(req.query.mes) || new Date().toISOString().slice(0, 7);
  const r = resumenVentas(mes);
  const cols = [
    { header: 'Fecha', key: 'fecha' }, { header: 'Efectivo', key: 'efectivo' }, { header: 'Tarjeta', key: 'tarjeta' },
    { header: 'Transferencia', key: 'transferencia' }, { header: 'Credito', key: 'credito' }, { header: 'Vales', key: 'vales' },
    { header: 'Total', key: 'total' }, { header: 'Ingreso a comisionar', key: 'comisionable' }, { header: 'Comision 1.5%', key: 'comision' },
  ];
  enviarCSV(res, `ventas_${mes}`, cols, r.filas);
});

module.exports = router;
module.exports.sincronizarIngreso = sincronizarIngreso;
