const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const mesInput = document.getElementById('mes');
const body = document.getElementById('tabla-body');
const campos = ['efectivo', 'tarjeta', 'transferencia', 'credito', 'vales'];

function kpi(label, valor) {
  return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${valor}</div></div>`;
}

async function cargar() {
  const mes = mesInput.value;
  document.getElementById('export-csv').href = `/api/ventas/export/csv?mes=${mes}`;
  const res = await fetch(`/api/ventas?mes=${mes}`);
  const d = await res.json();
  const t = d.totales;
  document.getElementById('kpis').innerHTML =
    kpi('Ventas del mes', fmt(t.total)) + kpi('Efectivo', fmt(t.efectivo)) + kpi('Tarjeta', fmt(t.tarjeta)) +
    kpi('Transferencia', fmt(t.transferencia)) + kpi('Credito', fmt(t.credito)) + kpi('Vales', fmt(t.vales));
  document.getElementById('comision').innerHTML =
    kpi('Ingreso a comisionar', fmt(d.comision.base)) + kpi(`Comision ${(d.comision.pct * 100).toFixed(1)}%`, fmt(d.comision.importe)) +
    kpi('Credito (no comisiona)', fmt(d.comision.excluido_credito));
  body.innerHTML = '';
  d.filas.forEach((f) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(f.fecha)}</td>` + campos.map((c) => `<td>${fmt(f[c])}</td>`).join('') +
      `<td><b>${fmt(f.total)}</b></td><td>${fmt(f.comisionable)}</td><td>${fmt(f.comision)}</td><td class="acciones-cell"></td>`;
    const cel = tr.querySelector('.acciones-cell');
    const e = document.createElement('button'); e.className = 'small secondary'; e.textContent = 'Editar';
    e.onclick = () => { document.getElementById('f-fecha').value = f.fecha; campos.forEach((c) => (document.getElementById('f-' + c).value = f[c])); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const x = document.createElement('button'); x.className = 'small danger'; x.textContent = 'Eliminar';
    x.onclick = async () => { if (confirm('Eliminar las ventas de ' + f.fecha + '?')) { await fetch('/api/ventas/' + f.fecha, { method: 'DELETE' }); cargar(); } };
    cel.append(e, x);
    body.appendChild(tr);
  });
}

document.getElementById('dia-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fecha = document.getElementById('f-fecha').value;
  const datos = {};
  campos.forEach((c) => (datos[c] = document.getElementById('f-' + c).value));
  const res = await fetch('/api/ventas/' + fecha, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
  if (!res.ok) return alert((await res.json().catch(() => ({}))).error || 'No se pudo guardar');
  mesInput.value = fecha.slice(0, 7);
  ev.target.reset();
  cargar();
});

document.getElementById('importar').addEventListener('change', async (ev) => {
  const archivo = ev.target.files[0];
  if (!archivo) return;
  const datos = new FormData();
  datos.set('archivo', archivo);
  datos.set('mes', mesInput.value);
  const res = await fetch('/api/ventas/importar', { method: 'POST', body: datos });
  const r = await res.json().catch(() => ({}));
  ev.target.value = '';
  if (!res.ok) return alert(r.error || 'No se pudo importar');
  alert(`Dias importados: ${r.importados}`);
  cargar();
});

mesInput.addEventListener('change', cargar);
requireAuth().then((u) => {
  if (!u) return;
  mesInput.value = new Date().toISOString().slice(0, 7);
  cargar();
});
