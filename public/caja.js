const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const mesInput = document.getElementById('mes');
const body = document.getElementById('tabla-body');
const kpi = (l, v) => `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`;

async function cargar() {
  const res = await fetch('/api/caja?mes=' + mesInput.value);
  const d = await res.json();
  const sel = document.getElementById('m-tipo');
  if (!sel.options.length) sel.innerHTML = d.tipos.map((t) => `<option value="${escapeHtml(t.tipo)}">${escapeHtml(t.tipo)} (${t.efecto > 0 ? 'entra' : 'sale'})</option>`).join('');
  document.getElementById('kpis').innerHTML =
    kpi('Saldo inicial', fmt(d.saldo_inicial)) + kpi('+ Ventas en efectivo', fmt(d.ventas_efectivo)) + kpi('+ Cobranza y otros', fmt(d.cobranza_y_otros)) +
    kpi('- Gastos en efectivo', fmt(d.gastos_efectivo)) + kpi('- Depositos', fmt(d.depositos)) + kpi('- Entregas', fmt(d.entregas)) +
    kpi('Saldo de caja', fmt(d.saldo_final)) + kpi('Depositos por confirmar', d.depositos_pendientes);
  const p = Object.entries(d.entregas_por_persona);
  document.getElementById('personas-kpi').innerHTML = p.length ? p.map(([n, v]) => kpi(escapeHtml(n), fmt(v))).join('') : '<span class="opcional">Sin entregas este mes.</span>';
  body.innerHTML = '';
  d.movimientos.forEach((m) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(m.fecha)}</td><td>${escapeHtml(m.tipo)}</td><td>${fmt(m.monto)}</td><td>${escapeHtml(m.concepto || '')}</td><td>${escapeHtml(m.persona || '')}</td><td>${escapeHtml(m.autorizo || '')}</td><td>${m.tipo === 'Deposito al banco' ? (m.depositado ? 'Confirmado' : 'Pendiente') : ''}</td><td class="acciones-cell"></td>`;
    const cel = tr.querySelector('.acciones-cell');
    if (m.tipo === 'Deposito al banco' && !m.depositado) {
      const c = document.createElement('button'); c.className = 'small secondary'; c.textContent = 'Confirmar';
      c.onclick = async () => { await fetch('/api/caja/' + m.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ depositado: 1 }) }); cargar(); };
      cel.appendChild(c);
    }
    const x = document.createElement('button'); x.className = 'small danger'; x.textContent = 'Eliminar';
    x.onclick = async () => { if (confirm('Eliminar este movimiento?')) { await fetch('/api/caja/' + m.id, { method: 'DELETE' }); cargar(); } };
    cel.appendChild(x);
    body.appendChild(tr);
  });
}

document.getElementById('mov-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const datos = {
    tipo: document.getElementById('m-tipo').value, fecha: document.getElementById('m-fecha').value, monto: document.getElementById('m-monto').value,
    concepto: document.getElementById('m-concepto').value.trim(), persona: document.getElementById('m-persona').value.trim(),
    autorizo: document.getElementById('m-autorizo').value.trim(), depositado: document.getElementById('m-depositado').checked,
  };
  const res = await fetch('/api/caja', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
  if (!res.ok) return alert((await res.json().catch(() => ({}))).error || 'No se pudo guardar');
  mesInput.value = datos.fecha.slice(0, 7);
  ev.target.reset();
  cargar();
});
mesInput.addEventListener('change', cargar);
requireAuth().then((u) => { if (!u) return; mesInput.value = new Date().toISOString().slice(0, 7); cargar(); });
