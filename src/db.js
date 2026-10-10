const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'data', 'cuentas.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS cuentas_por_pagar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proveedor TEXT NOT NULL,
    concepto TEXT NOT NULL,
    numero_factura TEXT NOT NULL,
    fecha_emision TEXT NOT NULL,
    fecha_vencimiento TEXT NOT NULL,
    monto REAL NOT NULL,
    pagada INTEGER NOT NULL DEFAULT 0,
    notificada_at TEXT,
    aviso_7_enviado INTEGER NOT NULL DEFAULT 0,
    aviso_3_enviado INTEGER NOT NULL DEFAULT 0,
    aviso_1_enviado INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const columnasCuentas = db.prepare('PRAGMA table_info(cuentas_por_pagar)').all().map((c) => c.name);
for (const columna of ['aviso_7_enviado', 'aviso_3_enviado', 'aviso_1_enviado']) {
  if (!columnasCuentas.includes(columna)) {
    db.exec(`ALTER TABLE cuentas_por_pagar ADD COLUMN ${columna} INTEGER NOT NULL DEFAULT 0`);
  }
}
if (!columnasCuentas.includes('sucursal')) {
  db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN sucursal TEXT');
}
if (!columnasCuentas.includes('tipo_gasto')) {
  db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN tipo_gasto TEXT');
}
if (!columnasCuentas.includes('es_fijo')) {
  db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN es_fijo INTEGER NOT NULL DEFAULT 0');
}
if (!columnasCuentas.includes('gasto_id')) {
  db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN gasto_id INTEGER');
}
// division: JSON { modo, partes: [{ sucursal, valor }] } cuando la cuenta se
// reparte entre varias clinicas. Al pagarse genera un gasto compartido cuyo
// grupo_id se guarda en gasto_grupo_id.
if (!columnasCuentas.includes('division')) {
  db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN division TEXT');
}
if (!columnasCuentas.includes('gasto_grupo_id')) {
  db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN gasto_grupo_id TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sucursal TEXT NOT NULL,
    tipo_gasto TEXT NOT NULL,
    concepto TEXT NOT NULL,
    fecha TEXT NOT NULL,
    monto REAL NOT NULL,
    proveedor TEXT,
    numero_factura TEXT,
    grupo_id TEXT,
    monto_total REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const columnasGastos = db.prepare('PRAGMA table_info(gastos)').all().map((c) => c.name);
if (!columnasGastos.includes('grupo_id')) {
  db.exec('ALTER TABLE gastos ADD COLUMN grupo_id TEXT');
}
if (!columnasGastos.includes('monto_total')) {
  db.exec('ALTER TABLE gastos ADD COLUMN monto_total REAL');
}
if (!columnasGastos.includes('comprobante')) {
  db.exec('ALTER TABLE gastos ADD COLUMN comprobante TEXT');
}
if (!columnasGastos.includes('marca')) {
  db.exec("ALTER TABLE gastos ADD COLUMN marca TEXT NOT NULL DEFAULT 'dentalmix'");
}


for (const [col, def] of [['rubro', 'TEXT'], ['forma_pago', 'TEXT'], ['autorizo', 'TEXT'], ['recibio', 'TEXT'], ['no_gasto', 'INTEGER NOT NULL DEFAULT 0'], ['origen', 'TEXT']]) {
  if (!columnasGastos.includes(col)) db.exec(`ALTER TABLE gastos ADD COLUMN ${col} ${def}`);
}

// Ventas por dia y forma de pago (de SICAR). Alimenta el ingreso del cierre y la comision.
db.exec(`
  CREATE TABLE IF NOT EXISTS ventas_dia (
    fecha TEXT PRIMARY KEY,
    efectivo REAL NOT NULL DEFAULT 0,
    tarjeta REAL NOT NULL DEFAULT 0,
    transferencia REAL NOT NULL DEFAULT 0,
    credito REAL NOT NULL DEFAULT 0,
    vales REAL NOT NULL DEFAULT 0,
    fuente TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Libro de caja (control interno del efectivo). Las ventas en efectivo y los gastos en efectivo
// no se capturan aqui: se toman de ventas_dia y de gastos (forma_pago = Efectivo).
db.exec(`
  CREATE TABLE IF NOT EXISTS caja_mov (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    monto REAL NOT NULL,
    concepto TEXT,
    persona TEXT,
    autorizo TEXT,
    depositado INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS ingresos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sucursal TEXT NOT NULL,
    mes TEXT NOT NULL,
    monto REAL NOT NULL,
    concepto TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Los ingresos empezaron como "un solo valor por sucursal+mes" (con UNIQUE).
// Ahora cada captura es un abono que se suma a los demas del mes, asi que hay
// que quitar esa restriccion en bases de datos que ya existian con el esquema viejo.
const indicesIngresos = db.prepare('PRAGMA index_list(ingresos)').all();
if (indicesIngresos.some((idx) => idx.unique)) {
  db.exec(`
    CREATE TABLE ingresos_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sucursal TEXT NOT NULL,
      mes TEXT NOT NULL,
      monto REAL NOT NULL,
      concepto TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    'INSERT INTO ingresos_nueva (id, sucursal, mes, monto, created_at) SELECT id, sucursal, mes, monto, created_at FROM ingresos'
  );
  db.exec('DROP TABLE ingresos');
  db.exec('ALTER TABLE ingresos_nueva RENAME TO ingresos');
}

const columnasIngresos = db.prepare('PRAGMA table_info(ingresos)').all().map((c) => c.name);
if (!columnasIngresos.includes('concepto')) {
  db.exec('ALTER TABLE ingresos ADD COLUMN concepto TEXT');
}
if (!columnasIngresos.includes('marca')) {
  db.exec("ALTER TABLE ingresos ADD COLUMN marca TEXT NOT NULL DEFAULT 'dentalmix'");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS sucursales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    activa INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Siembra sucursales nuevas que aparezcan en SUCURSALES_INICIALES pero que
// todavia no existan en la base de datos (INSERT OR IGNORE es seguro correrlo
// en cada arranque: no duplica ni reactiva una sucursal que se dio de baja).
const { SUCURSALES_INICIALES } = require('./constants');
const sembrarSucursal = db.prepare('INSERT OR IGNORE INTO sucursales (nombre) VALUES (?)');
for (const nombre of SUCURSALES_INICIALES) {
  sembrarSucursal.run(nombre);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

module.exports = db;
