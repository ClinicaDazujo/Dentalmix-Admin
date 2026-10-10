// Dentalmix es un solo deposito dental: toda la informacion se registra en
// esta unica "sucursal" interna (no se muestra en pantalla).
const SUCURSAL_UNICA = 'Dentalmix';
const SUCURSALES_INICIALES = [SUCURSAL_UNICA];

// Dentalmix no clasifica sus gastos por tipo.
const TIPOS_GASTO = [];

// Se conserva la estructura de "marcas" de la app original con una sola marca.
const MARCAS = ['dentalmix'];
const TOMOX_SUCURSALES = [];
const SUCURSAL_LABORATORIO = 'Laboratorio';

// Meta mensual de ingreso (se aplica igual todos los meses): 60,000 por semana.
const METAS_MENSUALES = {
  [SUCURSAL_UNICA]: 240000,
};

// Catalogo de rubros/conceptos de gasto (los mismos de la Conciliacion de Gastos).
const RUBROS = [
  'MERCANCIA', 'NOMINA Q1', 'NOMINA Q2', 'ARRENDAMIENTO', 'IMSS', 'TELEFONO / SIN CFDI', 'COMISIONES BANCARIAS', 'SIN CFDI',
  'Comisiones de ventas', 'Papeleria y limpieza', 'Transporte y viaticos', 'Fletes y paqueteria', 'Compras de material',
  'Nomina y honorarios', 'Servicios (luz, agua, internet)', 'Mantenimiento y reparaciones', 'Otros (detallar concepto)',
  'PAGO CAMIONETA', 'GARANTIA LEASING', 'DAZUJO (ENVIO DE DINERO)', 'EQUIPO (NO BREAK)',
];
// Conceptos que salen del banco/caja pero NO son gasto del mes (capital, garantias, traspasos entre entidades, activo fijo).
const NO_GASTO_RUBROS = ['PAGO CAMIONETA', 'GARANTIA LEASING', 'DAZUJO (ENVIO DE DINERO)', 'EQUIPO (NO BREAK)'];
const FORMAS_PAGO = ['Efectivo', 'Banco', 'Tarjeta de credito'];
// Comision sobre efectivo + tarjeta + transferencia (el credito no se comisiona).
const COMISION_PCT = 0.015;
// Tipos de movimiento del libro de caja y su efecto (+1 entra, -1 sale).
const TIPOS_CAJA = {
  'Saldo inicial': 1,
  'Cobranza de credito en efectivo': 1,
  'Reembolso o devolucion a caja': 1,
  'Ajuste por sobrante': 1,
  'Deposito al banco': -1,
  'Entrega a encargado': -1,
  'Ajuste por faltante': -1,
};

module.exports = { RUBROS, NO_GASTO_RUBROS, FORMAS_PAGO, COMISION_PCT, TIPOS_CAJA, SUCURSALES_INICIALES, SUCURSAL_UNICA, TIPOS_GASTO, METAS_MENSUALES, MARCAS, TOMOX_SUCURSALES, SUCURSAL_LABORATORIO };
