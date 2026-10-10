const form = document.getElementById('gasto-form');
const tablaBody = document.getElementById('tabla-body');
const cancelEditBtn = document.getElementById('cancel-edit');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const filtroSucursal = document.getElementById('filtro-sucursal');
const filtroMes = document.getElementById('filtro-mes');
const filtroAnio = document.getElementById('filtro-anio');
const exportCsvLink = document.getElementById('export-csv');
const exportXlsxLink = document.getElementById('export-xlsx');
const selectSucursal = document.getElementById('sucursal');
const esCompartido = document.getElementById('es-compartido');
const compartidoToggleWrap = document.getElementById('compartido-toggle-wrap');
const sucursalWrap = document.getElementById('sucursal-wrap');
const modoCompartidoWrap = document.getElementById('modo-compartido-wrap');
const modoCompartido = document.getElementById('modo-compartido');
const sucursalesCompartidoWrap = document.getElementById('sucursales-compartido-wrap');
const sucursalesCompartidoLabel = document.getElementById('sucursales-compartido-label');
const sucursalesCompartido = document.getElementById('sucursales-compartido');
const montoWrap = document.getElementById('monto-wrap');
const montoLabel = document.getElementById('monto-label');
const paginaAnteriorBtn = document.getElementById('pagina-anterior');
const paginaSiguienteBtn = document.getElementById('pagina-siguiente');
const paginaInfo = document.getElementById('pagina-info');

const TAMANO_PAGINA = 10;
let gastosCache = [];
let paginaActual = 1;
let sucursalesDisponibles = [];
let sucursalesTodas = [];
let tomoxSucursales = [];

const fmtMoneda = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const MESES_NOMBRES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function llenarFiltroMesAnio() {
  filtroMes.innerHTML =
    '<option value="">Todos los meses</option>' +
    MESES_NOMBRES.map((nombre, i) => `<option value="${String(i + 1).padStart(2, '0')}">${nombre}</option>`).join('');

  const anioActual = new Date().getFullYear();
  let opciones = '<option value="">Todos los años</option>';
  for (let a = anioActual + 1; a >= anioActual - 3; a--) {
    opciones += `<option value="${a}">${a}</option>`;
  }
  filtroAnio.innerHTML = opciones;
}

async function cargarConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  window.__cfg = cfg;
  const { sucursales, tomoxSucursales: tomoxDeConfig } = cfg;

  const cfg2 = window.__cfg || {};
  document.getElementById('rubro').innerHTML = '<option value="">Elige un rubro</option>' + (cfg2.rubros || []).map((r) => `<option>${r}</option>`).join('');
  document.getElementById('forma-pago').innerHTML = (cfg2.formasPago || []).map((r) => `<option>${r}</option>`).join('');
  sucursalesTodas = sucursales;
  tomoxSucursales = tomoxDeConfig;
  actualizarUIporMarca();
}

function sucursalesParaMarca() {
  const marca = marcaActual();
  if (marca === 'tomox') return sucursalesTodas.filter((s) => tomoxSucursales.includes(s));
  if (marca === 'laboratorio') return [];
  return sucursalesTodas;
}


function actualizarUIporMarca() {
  sucursalesDisponibles = sucursalesParaMarca();
  const esLaboratorio = marcaActual() === 'laboratorio';

  selectSucursal.innerHTML = sucursalesDisponibles.map((s) => `<option value="${s}">${s}</option>`).join('');
  filtroSucursal.innerHTML =
    '<option value="">Todas las sucursales</option>' + sucursalesDisponibles.map((s) => `<option value="${s}">${s}</option>`).join('');
  filtroSucursal.hidden = true; // Dentalmix tiene una sola sucursal

  if (esLaboratorio) esCompartido.checked = false;
  compartidoToggleWrap.hidden = true;


  renderSucursalesCompartido();
  actualizarModoCompartido();
}

function renderSucursalesCompartido() {
  const modo = modoCompartido.value;
  sucursalesCompartido.classList.toggle('con-valores', modo !== 'igual');
  sucursalesCompartido.innerHTML = '';

  sucursalesDisponibles.forEach((s) => {
    const fila = document.createElement('label');
    fila.className = modo === 'igual' ? '' : 'fila-division';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.value = s;

    const texto = document.createElement('span');
    texto.textContent = s;

    fila.appendChild(chk);
    fila.appendChild(texto);

    if (modo !== 'igual') {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.disabled = true;
      input.placeholder = modo === 'cantidad' ? '$' : '%';
      chk.addEventListener('change', () => {
        input.disabled = !chk.checked;
        if (!chk.checked) input.value = '';
      });
      fila.appendChild(input);
    }

    sucursalesCompartido.appendChild(fila);
  });
}

function recolectarSeleccionCompartido() {
  const filas = [];
  sucursalesCompartido.querySelectorAll('label').forEach((fila) => {
    const inputs = fila.querySelectorAll('input');
    const chk = inputs[0];
    if (!chk.checked) return;
    const valorInput = inputs[1];
    filas.push({ sucursal: chk.value, valor: valorInput ? valorInput.value : null });
  });
  return filas;
}

function actualizarModoCompartido() {
  const esLaboratorio = marcaActual() === 'laboratorio';
  const activo = !esLaboratorio && esCompartido.checked;
  const modo = modoCompartido.value;
  sucursalWrap.hidden = true;
  modoCompartidoWrap.hidden = !activo;
  sucursalesCompartidoWrap.hidden = !activo;
  selectSucursal.required = !esLaboratorio && !activo;

  if (!activo) {
    montoWrap.hidden = false;
    montoLabel.textContent = 'Monto';
    document.getElementById('monto').required = true;
  } else if (modo === 'cantidad') {
    montoWrap.hidden = true;
    document.getElementById('monto').required = false;
    sucursalesCompartidoLabel.textContent = 'Clinicas y cantidad que le corresponde a cada una';
  } else if (modo === 'porcentaje') {
    montoWrap.hidden = false;
    montoLabel.textContent = 'Monto total (se repartira segun los porcentajes)';
    document.getElementById('monto').required = true;
    sucursalesCompartidoLabel.textContent = 'Clinicas y porcentaje que le corresponde a cada una';
  } else {
    montoWrap.hidden = false;
    montoLabel.textContent = 'Monto total (se dividira entre las clinicas seleccionadas)';
    document.getElementById('monto').required = true;
    sucursalesCompartidoLabel.textContent = 'Clinicas que comparten el gasto';
  }
}

esCompartido.addEventListener('change', () => {
  renderSucursalesCompartido();
  actualizarModoCompartido();
});
modoCompartido.addEventListener('change', () => {
  renderSucursalesCompartido();
  actualizarModoCompartido();
});

async function cargarGastos() {
  const res = await fetch('/api/gastos');
  gastosCache = await res.json();
  paginaActual = 1;
  renderTabla();
}

function actualizarEnlacesExport() {
  const params = new URLSearchParams();
  params.set('marca', marcaActual());
  if (filtroSucursal.value) params.set('sucursal', filtroSucursal.value);
  if (filtroMes.value) params.set('mes', filtroMes.value);
  if (filtroAnio.value) params.set('anio', filtroAnio.value);

  const query = params.toString();
  exportCsvLink.href = `/api/gastos/export/csv${query ? `?${query}` : ''}`;
  exportXlsxLink.href = `/api/gastos/export/xlsx${query ? `?${query}` : ''}`;
}

function renderTabla() {
  const marca = marcaActual();
  const sucursal = filtroSucursal.value;
  const mes = filtroMes.value;
  const anio = filtroAnio.value;
  const filtradas = gastosCache.filter((g) => {
    if (g.marca !== marca) return false;
    if (sucursal && g.sucursal !== sucursal) return false;
    if (mes && g.fecha.slice(5, 7) !== mes) return false;
    if (anio && g.fecha.slice(0, 4) !== anio) return false;
    return true;
  });
  actualizarEnlacesExport();

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / TAMANO_PAGINA));
  if (paginaActual > totalPaginas) paginaActual = totalPaginas;
  const inicio = (paginaActual - 1) * TAMANO_PAGINA;
  const filas = filtradas.slice(inicio, inicio + TAMANO_PAGINA);

  paginaInfo.textContent = `Página ${paginaActual} de ${totalPaginas}`;
  paginaAnteriorBtn.disabled = paginaActual <= 1;
  paginaSiguienteBtn.disabled = paginaActual >= totalPaginas;

  tablaBody.innerHTML = '';
  filas.forEach((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(g.fecha)}</td>
      <td>${escapeHtml(g.rubro || '')}${g.no_gasto ? ' <span class="opcional">(no es gasto del mes)</span>' : ''}</td>
      <td>${escapeHtml(g.concepto)}</td>
      <td>${escapeHtml(g.forma_pago || '')}</td>
      <td>${fmtMoneda(g.monto)}</td>
      <td>${escapeHtml(g.autorizo || '')}</td>
      <td>${g.comprobante ? `<a href="/api/gastos/comprobante/${encodeURIComponent(g.comprobante)}" target="_blank" rel="noopener">Ver</a>` : '-'}</td>
      <td class="acciones-cell"></td>
    `;

    const celdaAcciones = tr.querySelector('.acciones-cell');

    const btnEditar = document.createElement('button');
    btnEditar.className = 'small secondary';
    btnEditar.textContent = 'Editar';
    btnEditar.onclick = () => cargarEnFormulario(g);
    celdaAcciones.appendChild(btnEditar);

    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'small danger';
    btnEliminar.textContent = 'Eliminar';
    btnEliminar.onclick = () => eliminarGasto(g.id);
    celdaAcciones.appendChild(btnEliminar);

    tablaBody.appendChild(tr);
  });
}

function cargarEnFormulario(g) {
  document.getElementById('gasto-id').value = g.id;
  esCompartido.checked = false;
  esCompartido.disabled = true;
  compartidoToggleWrap.hidden = true;
  actualizarModoCompartido();
  selectSucursal.value = g.sucursal;
  document.getElementById('concepto').value = g.concepto;
  document.getElementById('rubro').value = g.rubro || '';
  document.getElementById('forma-pago').value = g.forma_pago || '';
  document.getElementById('autorizo').value = g.autorizo || '';
  document.getElementById('recibio').value = g.recibio || '';
  document.getElementById('fecha').value = g.fecha;
  document.getElementById('monto').value = g.monto;
  document.getElementById('comprobante-actual').textContent = g.comprobante
    ? 'Ya tiene comprobante (sube uno nuevo para reemplazarlo)'
    : '';
  formTitle.textContent = 'Editar gasto';
  submitBtn.textContent = 'Actualizar';
  cancelEditBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function limpiarFormulario() {
  form.reset();
  document.getElementById('gasto-id').value = '';
  document.getElementById('comprobante-actual').textContent = '';
  esCompartido.disabled = false;
  compartidoToggleWrap.hidden = true;
  modoCompartido.value = 'igual';
  renderSucursalesCompartido();
  actualizarModoCompartido();
  formTitle.textContent = 'Nuevo gasto';
  submitBtn.textContent = 'Guardar';
  cancelEditBtn.hidden = true;
}

async function eliminarGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  await fetch(`/api/gastos/${id}`, { method: 'DELETE' });
  cargarGastos();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('gasto-id').value;
  const compartido = !id && esCompartido.checked;
  const archivoComprobante = document.getElementById('comprobante').files[0];

  let url = id ? `/api/gastos/${id}` : '/api/gastos';
  const method = id ? 'PUT' : 'POST';
  const datos = new FormData();
  datos.set('concepto', document.getElementById('concepto').value.trim());
  datos.set('fecha', document.getElementById('fecha').value);
  datos.set('monto', document.getElementById('monto').value);
  datos.set('rubro', document.getElementById('rubro').value);
  datos.set('forma_pago', document.getElementById('forma-pago').value);
  datos.set('autorizo', document.getElementById('autorizo').value.trim());
  datos.set('recibio', document.getElementById('recibio').value.trim());
  if (archivoComprobante) datos.set('comprobante', archivoComprobante);
  if (!id) datos.set('marca', marcaActual());

  if (compartido) {
    const modo = modoCompartido.value;
    const partes = recolectarSeleccionCompartido();

    if (partes.length < 2) {
      alert('Selecciona al menos 2 clinicas para dividir el gasto.');
      return;
    }
    if (modo !== 'igual' && partes.some((p) => !p.valor)) {
      alert(modo === 'cantidad' ? 'Escribe la cantidad de cada clinica seleccionada.' : 'Escribe el porcentaje de cada clinica seleccionada.');
      return;
    }
    if (modo === 'porcentaje') {
      const sumaPct = partes.reduce((s, p) => s + Number(p.valor), 0);
      if (Math.abs(sumaPct - 100) > 0.5) {
        alert(`Los porcentajes deben sumar 100% (ahora suman ${sumaPct.toFixed(1)}%).`);
        return;
      }
    }

    url = '/api/gastos/compartido';
    datos.set('modo', modo);
    datos.set('partes', JSON.stringify(partes));
  } else if (marcaActual() !== 'laboratorio') {
    datos.set('sucursal', selectSucursal.value);
  }

  const res = await fetch(url, { method, body: datos });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Ocurrio un error al guardar el gasto.');
    return;
  }

  limpiarFormulario();
  cargarGastos();
});


cancelEditBtn.addEventListener('click', limpiarFormulario);
filtroSucursal.addEventListener('change', () => {
  paginaActual = 1;
  renderTabla();
});
filtroMes.addEventListener('change', () => {
  paginaActual = 1;
  renderTabla();
});
filtroAnio.addEventListener('change', () => {
  paginaActual = 1;
  renderTabla();
});
paginaAnteriorBtn.addEventListener('click', () => {
  paginaActual -= 1;
  renderTabla();
});
paginaSiguienteBtn.addEventListener('click', () => {
  paginaActual += 1;
  renderTabla();
});

window.addEventListener('marcaCambiada', () => {
  limpiarFormulario();
  actualizarUIporMarca();
  paginaActual = 1;
  renderTabla();
});

requireAuth().then(async (user) => {
  if (!user) return;
  llenarFiltroMesAnio();
  await cargarConfig();
  cargarGastos();
});

document.getElementById('importar-concil').addEventListener('change', async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  const datos = new FormData();
  datos.set('archivo', archivo);
  const res = await fetch('/api/gastos/importar-conciliacion', { method: 'POST', body: datos });
  const r = await res.json().catch(() => ({}));
  e.target.value = '';
  if (!res.ok) return alert(r.error || 'No se pudo cargar el archivo.');
  alert(`Gastos nuevos: ${r.nuevos}. Ya estaban cargados: ${r.repetidos}.`);
  cargarGastos();
});
