const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { enviarCSV, enviarXLSX } = require('../export');
const { MARCAS, TOMOX_SUCURSALES, SUCURSAL_LABORATORIO, RUBROS, NO_GASTO_RUBROS, FORMAS_PAGO, SUCURSAL_UNICA } = require('../constants');
const ExcelJS = require('exceljs');
const sucursalesDb = require('../sucursales');
const { calcularDivision, nuevoGrupoId } = require('../division');

const router = express.Router();

const DIR_COMPROBANTES = path.join(__dirname, '..', '..', 'data', 'comprobantes');
fs.mkdirSync(DIR_COMPROBANTES, { recursive: true });

const EXTENSIONES_PERMITIDAS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR_COMPROBANTES),
    filename: (req, file, cb) => {
      const ext = EXTENSIONES_PERMITIDAS[file.mimetype] || path.extname(file.originalname) || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXTENSIONES_PERMITIDAS[file.mimetype]) return cb(new Error('El comprobante debe ser una imagen (jpg, png o webp)'));
    cb(null, true);
  },
});

function borrarComprobante(nombreArchivo) {
  if (!nombreArchivo) return;
  fs.unlink(path.join(DIR_COMPROBANTES, nombreArchivo), () => {});
}

const COLUMNAS = [
  { header: 'Fecha', key: 'fecha', width: 14 },
  { header: 'Rubro', key: 'rubro', width: 26 },
  { header: 'Concepto', key: 'concepto', width: 34 },
  { header: 'Forma de pago', key: 'forma_pago', width: 18 },
  { header: 'Monto', key: 'monto', width: 15 },
  { header: 'Autorizo', key: 'autorizo', width: 16 },
  { header: 'Recibio', key: 'recibio', width: 16 },
  { header: 'No es gasto del mes', key: 'no_gasto_txt', width: 18 },
];

function extras(body, existente = {}) {
  const rubro = String(body.rubro ?? existente.rubro ?? '').trim();
  const forma = String(body.forma_pago ?? existente.forma_pago ?? '').trim();
  return {
    rubro,
    forma_pago: forma,
    autorizo: String(body.autorizo ?? existente.autorizo ?? '').trim(),
    recibio: String(body.recibio ?? existente.recibio ?? '').trim(),
    no_gasto: NO_GASTO_RUBROS.includes(rubro) ? 1 : 0,
  };
}

function validarExtras(x) {
  if (!x.rubro) return 'Falta el rubro del gasto';
  if (!FORMAS_PAGO.includes(x.forma_pago)) return 'Falta la forma de pago';
  if (x.forma_pago === 'Efectivo' && !x.autorizo) return 'Falta quien autorizo el gasto en efectivo';
  return null;
}

function paraExportar(gastos) {
  return gastos.map((g) => ({ ...g, compartido: g.grupo_id ? 'Si' : 'No', no_gasto_txt: g.no_gasto ? 'Si' : '' }));
}

// Valida que la sucursal tenga sentido para la marca indicada. Para
// Laboratorio no se le pide sucursal al usuario: siempre se usa la misma
// sucursal ficticia fija (el gasto de Laboratorio no se reparte por clinica).
function sucursalValidaParaMarca(sucursal, marca) {
  if (marca === 'laboratorio') return sucursal === SUCURSAL_LABORATORIO;
  if (marca === 'tomox') return TOMOX_SUCURSALES.includes(sucursal) && sucursalesDb.existeActiva(sucursal);
  return sucursalesDb.existeActiva(sucursal);
}

function normalizarMarcaYSucursal(body) {
  const marca = MARCAS.includes(body.marca) ? body.marca : 'dentalmix';
  if (marca === 'laboratorio') body.sucursal = SUCURSAL_LABORATORIO;
  return marca;
}

// Dentalmix no clasifica sus gastos por tipo: la columna tipo_gasto de la
// base de datos se conserva pero siempre se guarda vacia.
const SIN_TIPO = '';

function validarGasto(body, marca) {
  const requeridos = ['sucursal', 'concepto', 'fecha', 'monto'];
  for (const campo of requeridos) {
    if (body[campo] === undefined || body[campo] === null || body[campo] === '') {
      return `Falta el campo: ${campo}`;
    }
  }
  if (!sucursalValidaParaMarca(body.sucursal, marca)) return 'Sucursal invalida';
  if (Number.isNaN(Number(body.monto))) return 'El monto debe ser un numero';
  return null;
}

function manejarErrorMulter(err, req, res, next) {
  if (err) return res.status(400).json({ error: err.message || 'Error al subir el comprobante' });
  next();
}

router.get('/', (req, res) => {
  const gastos = db.prepare('SELECT * FROM gastos ORDER BY fecha DESC, id DESC').all();
  res.json(gastos);
});

router.get('/comprobante/:archivo', (req, res) => {
  const existe = db.prepare('SELECT id FROM gastos WHERE comprobante = ?').get(req.params.archivo);
  if (!existe) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.join(DIR_COMPROBANTES, req.params.archivo));
});

router.post('/', upload.single('comprobante'), manejarErrorMulter, (req, res) => {
  const marca = normalizarMarcaYSucursal(req.body);
  const error = validarGasto(req.body, marca);
  if (error) {
    borrarComprobante(req.file?.filename);
    return res.status(400).json({ error });
  }

  const x = extras(req.body);
  const errX = validarExtras(x);
  if (errX) {
    borrarComprobante(req.file?.filename);
    return res.status(400).json({ error: errX });
  }

  const { sucursal, concepto, fecha, monto } = req.body;
  const info = db
    .prepare(
      `INSERT INTO gastos (sucursal, tipo_gasto, concepto, fecha, monto, comprobante, marca, rubro, forma_pago, autorizo, recibio, no_gasto, origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captura')`
    )
    .run(sucursal, SIN_TIPO, concepto, fecha, Number(monto), req.file?.filename || null, marca, x.rubro, x.forma_pago, x.autorizo, x.recibio, x.no_gasto);

  const nuevo = db.prepare('SELECT * FROM gastos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(nuevo);
});

router.post('/compartido', upload.single('comprobante'), manejarErrorMulter, (req, res) => {
  const { concepto, fecha } = req.body;
  const modo = req.body.modo || 'igual';
  const marca = MARCAS.includes(req.body.marca) ? req.body.marca : 'dentalmix';

  let partes = req.body.partes;
  if (typeof partes === 'string') {
    try {
      partes = JSON.parse(partes);
    } catch {
      partes = [];
    }
  }

  const fallar = (error) => {
    borrarComprobante(req.file?.filename);
    return res.status(400).json({ error });
  };

  if (marca === 'laboratorio') return fallar('Laboratorio no admite gastos divididos por sucursal');

  const division = calcularDivision(modo, partes, req.body.monto, (s) => sucursalValidaParaMarca(s, marca));
  if (division.error) return fallar(division.error);
  if (!concepto) return fallar('Falta el campo: concepto');
  if (!fecha) return fallar('Falta el campo: fecha');

  const { filas: filasMonto, montoTotal } = division;
  const grupoId = nuevoGrupoId();
  const insert = db.prepare(
    `INSERT INTO gastos (sucursal, tipo_gasto, concepto, fecha, monto, grupo_id, monto_total, comprobante, marca)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const creados = filasMonto.map((f) => {
    const info = insert.run(f.sucursal, SIN_TIPO, concepto, fecha, f.monto, grupoId, montoTotal, req.file?.filename || null, marca);
    return db.prepare('SELECT * FROM gastos WHERE id = ?').get(info.lastInsertRowid);
  });

  res.status(201).json(creados);
});

router.put('/:id', upload.single('comprobante'), manejarErrorMulter, (req, res) => {
  const existente = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  if (!existente) {
    borrarComprobante(req.file?.filename);
    return res.status(404).json({ error: 'No encontrado' });
  }

  const sucursal = req.body.sucursal ?? existente.sucursal;
  const concepto = req.body.concepto ?? existente.concepto;
  const fecha = req.body.fecha ?? existente.fecha;
  const monto = req.body.monto !== undefined ? Number(req.body.monto) : existente.monto;
  const comprobante = req.file ? req.file.filename : existente.comprobante;

  const x = extras(req.body, existente);
  const errX = x.rubro || x.forma_pago ? validarExtras(x) : null;
  if (errX) {
    borrarComprobante(req.file?.filename);
    return res.status(400).json({ error: errX });
  }

  db.prepare(
    `UPDATE gastos
     SET sucursal = ?, concepto = ?, fecha = ?, monto = ?, comprobante = ?, rubro = ?, forma_pago = ?, autorizo = ?, recibio = ?, no_gasto = ?
     WHERE id = ?`
  ).run(sucursal, concepto, fecha, monto, comprobante, x.rubro, x.forma_pago, x.autorizo, x.recibio, x.no_gasto, req.params.id);

  if (req.file && existente.comprobante) borrarComprobante(existente.comprobante);

  const actualizado = db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id);
  res.json(actualizado);
});

router.delete('/:id', (req, res) => {
  const existente = db.prepare('SELECT comprobante FROM gastos WHERE id = ?').get(req.params.id);
  const info = db.prepare('DELETE FROM gastos WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  if (existente?.comprobante) borrarComprobante(existente.comprobante);
  res.status(204).end();
});

function gastosFiltrados(query) {
  const condiciones = [];
  const parametros = [];

  if (query.sucursal) {
    condiciones.push('sucursal = ?');
    parametros.push(query.sucursal);
  }
  if (query.mes && /^\d{2}$/.test(query.mes)) {
    condiciones.push("substr(fecha, 6, 2) = ?");
    parametros.push(query.mes);
  }
  if (query.anio && /^\d{4}$/.test(query.anio)) {
    condiciones.push("substr(fecha, 1, 4) = ?");
    parametros.push(query.anio);
  }
  if (query.marca && MARCAS.includes(query.marca)) {
    condiciones.push('marca = ?');
    parametros.push(query.marca);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM gastos ${where} ORDER BY fecha DESC, id DESC`).all(...parametros);
}

function nombreArchivoExport(query) {
  const partes = ['gastos', query.marca, query.sucursal, query.anio, query.mes].filter(Boolean);
  return partes.join('_');
}

function conFilaTotal(filas) {
  const suma = Math.round(filas.reduce((s, f) => s + f.monto, 0) * 100) / 100;
  return [...filas, { concepto: 'TOTAL', monto: suma }];
}

router.get('/export/csv', (req, res) => {
  const gastos = gastosFiltrados(req.query);
  enviarCSV(res, nombreArchivoExport(req.query), COLUMNAS, conFilaTotal(paraExportar(gastos)));
});

router.get('/export/xlsx', async (req, res) => {
  const gastos = gastosFiltrados(req.query);
  await enviarXLSX(res, nombreArchivoExport(req.query), 'Gastos', COLUMNAS, conFilaTotal(paraExportar(gastos)));
});

const upload2 = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const valorCelda = (c) => {
  const v = c?.value;
  if (v && typeof v === 'object' && 'result' in v) return v.result;
  if (v && typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  return v;
};
const aFecha = (v) =>
  v instanceof Date
    ? `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
    : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
    ? v.slice(0, 10)
    : null;

// Carga el Excel de la Conciliacion de Gastos (hojas "Gastos banco" y "Gastos TC", generado por clasificar_gastos_banco.py).
// Cada renglon queda como gasto con su CONCEPTO como rubro. Si se vuelve a cargar el mismo archivo no duplica.
router.post('/importar-conciliacion', upload2.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'No se pudo leer el archivo. Debe ser .xlsx' });
  }
  const hojas = [
    ['Gastos banco', 'Banco'],
    ['Gastos TC', 'Tarjeta de credito'],
  ];
  const existe = db.prepare("SELECT id FROM gastos WHERE origen = 'importacion' AND fecha = ? AND monto = ? AND rubro = ? AND forma_pago = ? AND concepto = ?");
  const ins = db.prepare(
    `INSERT INTO gastos (sucursal, tipo_gasto, concepto, fecha, monto, marca, rubro, forma_pago, autorizo, recibio, no_gasto, origen)
     VALUES (?, '', ?, ?, ?, 'dentalmix', ?, ?, '', '', ?, 'importacion')`
  );
  let nuevos = 0;
  let repetidos = 0;
  for (const [nombre, forma] of hojas) {
    const ws = wb.getWorksheet(nombre);
    if (!ws) continue;
    let enc = null;
    ws.eachRow((row) => {
      if (!enc) {
        const m = {};
        row.eachCell((cell, col) => {
          const t = String(valorCelda(cell) ?? '').trim().toUpperCase();
          if (t === 'FECHA') m.fecha = col;
          else if (t.startsWith('PROVEEDOR')) m.prov = col;
          else if (t === 'DIFERENCIA') m.monto = col;
          else if (t === 'CONCEPTO') m.conc = col;
        });
        if (m.fecha && m.monto && m.conc) enc = m;
        return;
      }
      const fecha = aFecha(valorCelda(row.getCell(enc.fecha)));
      const monto = Number(valorCelda(row.getCell(enc.monto)));
      const rubro = String(valorCelda(row.getCell(enc.conc)) ?? '').trim();
      if (!fecha || !(monto > 0) || !rubro) return;
      const concepto = String(valorCelda(row.getCell(enc.prov)) ?? '').trim() || rubro;
      if (existe.get(fecha, monto, rubro, forma, concepto)) return void repetidos++;
      ins.run(SUCURSAL_UNICA, concepto, fecha, monto, rubro, forma, NO_GASTO_RUBROS.includes(rubro) ? 1 : 0);
      nuevos++;
    });
  }
  res.json({ nuevos, repetidos });
});

module.exports = router;
