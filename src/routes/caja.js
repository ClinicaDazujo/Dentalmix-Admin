const express = require('express');
const db = require('../db');
const { TIPOS_CAJA } = require('../constants');

const router = express.Router();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const mesValido = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? m : null);

// Saldo de caja de todo lo ocurrido ANTES de `desde` (YYYY-MM-DD) o hasta `hasta` inclusive.
function acumulado(hasta) {
  const ventas = db.prepare('SELECT COALESCE(SUM(efectivo), 0) AS t FROM ventas_dia WHERE fecha <= ?').get(hasta).t;
  const gastos = db.prepare("SELECT COALESCE(SUM(monto), 0) AS t FROM gastos WHERE forma_pago = 'Efectivo' AND fecha <= ?").get(hasta).t;
  const movs = db.prepare('SELECT tipo, monto FROM caja_mov WHERE fecha <= ?').all(hasta);
  let neto = 0;
  for (const m of movs) neto += (TIPOS_CAJA[m.tipo] || 0) * m.monto;
  return r2(ventas - gastos + neto);
}

function resumenMes(mes) {
  const desde = `${mes}-01`;
  const hasta = `${mes}-31`;
  const dia0 = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1) - 86400000).toISOString().slice(0, 10);
  const saldoInicial = acumulado(dia0);
  const ventasEfectivo = db.prepare('SELECT COALESCE(SUM(efectivo), 0) AS t FROM ventas_dia WHERE fecha BETWEEN ? AND ?').get(desde, hasta).t;
  const gastosEfectivo = db.prepare("SELECT COALESCE(SUM(monto), 0) AS t FROM gastos WHERE forma_pago = 'Efectivo' AND fecha BETWEEN ? AND ?").get(desde, hasta).t;
  const movs = db.prepare('SELECT * FROM caja_mov WHERE fecha BETWEEN ? AND ? ORDER BY fecha, id').all(desde, hasta);
  const porTipo = {};
  for (const m of movs) porTipo[m.tipo] = r2((porTipo[m.tipo] || 0) + m.monto);

  const entradas = r2(ventasEfectivo + movs.filter((m) => TIPOS_CAJA[m.tipo] > 0 && m.tipo !== 'Saldo inicial').reduce((s, m) => s + m.monto, 0));
  const salidas = r2(gastosEfectivo + movs.filter((m) => TIPOS_CAJA[m.tipo] < 0).reduce((s, m) => s + m.monto, 0));
  const inicialMes = r2(saldoInicial + movs.filter((m) => m.tipo === 'Saldo inicial').reduce((s, m) => s + m.monto, 0));
  const saldoFinal = r2(inicialMes + entradas - salidas);

  const depositos = movs.filter((m) => m.tipo === 'Deposito al banco');
  const entregas = movs.filter((m) => m.tipo === 'Entrega a encargado');
  const porPersona = {};
  for (const e of entregas) porPersona[e.persona || '(sin nombre)'] = r2((porPersona[e.persona || '(sin nombre)'] || 0) + e.monto);

  return {
    mes,
    saldo_inicial: inicialMes,
    ventas_efectivo: r2(ventasEfectivo),
    gastos_efectivo: r2(gastosEfectivo),
    cobranza_y_otros: r2(entradas - ventasEfectivo),
    depositos: r2(depositos.reduce((s, m) => s + m.monto, 0)),
    depositos_pendientes: depositos.filter((m) => !m.depositado).length,
    entregas: r2(entregas.reduce((s, m) => s + m.monto, 0)),
    entregas_por_persona: porPersona,
    saldo_final: saldoFinal,
    movimientos: movs,
  };
}

function validar(b) {
  if (!(b.tipo in TIPOS_CAJA)) return 'Tipo de movimiento invalido';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '')) return 'Fecha invalida';
  if (Number.isNaN(Number(b.monto)) || Number(b.monto) <= 0) return 'El monto debe ser mayor a cero';
  if (['Entrega a encargado', 'Ajuste por faltante', 'Ajuste por sobrante'].includes(b.tipo) && !String(b.concepto || '').trim()) return 'Escribe el concepto';
  if (['Entrega a encargado', 'Ajuste por faltante'].includes(b.tipo) && !String(b.autorizo || '').trim()) return 'Falta quien autorizo';
  if (b.tipo === 'Entrega a encargado' && !String(b.persona || '').trim()) return 'Falta quien recibio';
  return null;
}

router.get('/', (req, res) => {
  const mes = mesValido(req.query.mes);
  if (!mes) return res.status(400).json({ error: 'Mes invalido, usa AAAA-MM' });
  res.json({ ...resumenMes(mes), tipos: Object.keys(TIPOS_CAJA).map((t) => ({ tipo: t, efecto: TIPOS_CAJA[t] })) });
});

router.post('/', (req, res) => {
  const err = validar(req.body);
  if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const info = db
    .prepare('INSERT INTO caja_mov (fecha, tipo, monto, concepto, persona, autorizo, depositado, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(b.fecha, b.tipo, r2(b.monto), b.concepto || null, b.persona || null, b.autorizo || null, b.depositado ? 1 : 0, req.user?.nombre || null);
  res.status(201).json(db.prepare('SELECT * FROM caja_mov WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const ex = db.prepare('SELECT * FROM caja_mov WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'No encontrado' });
  const b = { ...ex, ...req.body };
  const err = validar(b);
  if (err) return res.status(400).json({ error: err });
  db.prepare('UPDATE caja_mov SET fecha=?, tipo=?, monto=?, concepto=?, persona=?, autorizo=?, depositado=? WHERE id=?').run(
    b.fecha, b.tipo, r2(b.monto), b.concepto || null, b.persona || null, b.autorizo || null, b.depositado ? 1 : 0, req.params.id
  );
  res.json(db.prepare('SELECT * FROM caja_mov WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM caja_mov WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  res.status(204).end();
});

module.exports = router;
