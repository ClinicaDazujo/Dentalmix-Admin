# Cambios a Dentalmix-Admin (fase 1)

## Nuevo
- **Ventas** (ventas.html): ventas por dia y forma de pago (efectivo, tarjeta, transferencia, credito, vales). Se importa el Excel "Ingresos por metodo de pago" o el corte diario de SICAR, o se captura a mano. Calcula la comision (1.5% de efectivo + tarjeta + transferencia; el credito no comisiona; `COMISION_PCT` en src/constants.js). El total del mes se copia solo a `ingresos`, por lo que Cierre de Mes y Proyeccion ya no necesitan captura manual.
- **Caja** (caja.html): libro de caja interno. Las ventas en efectivo salen de Ventas y los gastos en efectivo de Gastos (forma de pago Efectivo). Aqui se capturan saldo inicial, cobranza en efectivo, depositos (con confirmacion en banco), entregas a encargados (quien recibio y quien autorizo) y ajustes. Muestra saldo de caja y entregas por persona.
- **Gastos**: nuevos campos rubro, forma de pago (Efectivo / Banco / Tarjeta de credito), autorizo y recibio. En efectivo, "autorizo" es obligatorio. El boton "Cargar conciliacion (Excel)" carga los gastos del banco y de la TC ya clasificados con `clasificar_gastos_banco.py` (no duplica si se vuelve a cargar).
- **No es gasto del mes**: PAGO CAMIONETA, GARANTIA LEASING, DAZUJO (ENVIO DE DINERO) y EQUIPO (NO BREAK) se guardan pero no cuentan como gasto en Cierre de Mes ni en Proyeccion (`NO_GASTO_RUBROS`).

## Modificado
- Base de datos (`src/db.js`): columnas nuevas en `gastos` (rubro, forma_pago, autorizo, recibio, no_gasto, origen) y tablas `ventas_dia` y `caja_mov`. Se crean solas al arrancar; no se pierde informacion existente.
- `src/routes/cierre.js` y `src/routes/proyeccion.js`: excluyen los gastos marcados como "no es gasto del mes".
- Menu: se agregan Ventas y Caja.

## Pendiente (siguientes fases)
- Importar las ventas directo del SICAR sin pasar por Excel.
- Importar depositos en efectivo del CSV del banco a Caja.
- Cruce ventas contra banco y creditos por clinica dentro del sistema.
- Costo de venta con inventario inicial y final.
