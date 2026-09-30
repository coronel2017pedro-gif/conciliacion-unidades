import { conciliar } from '../src/lib/reconcile'
const l = [{ factura_folio: 'F1', factura_fecha: '2026-09-15', linea: 1, placa: 'AAA1', serie: null, vehiculo: 'X', plaza: 'IRAPUATO', inicio: '2026-09-01', fin: '2026-09-15', dias: 15, tarifa: 100, subtotal: 1500, inicio_explicito: false }]
const rutas = [1, 2, 3, 12, 13, 14, 15].map(d => ({ fecha: `2026-09-${String(d).padStart(2, '0')}`, placa: 'AAA1', id_ruta: String(d) }))
const inc = [{ id: '1', placa: 'AAA1', tipo: 'taller' as const, fecha_inicio: '2026-09-04', fecha_fin: '2026-09-10', descuenta: true, plaza: 'IRAPUATO', plaza_destino: null, notas: null }]
const u = [{ placa: 'AAA1', plaza: 'IRAPUATO', tipo: 'SV', vehiculo: 'X', serie: null, operador: null, fecha_entrega: null, activa: true }]
const r = conciliar(l, inc, rutas, u)[0]
console.log(r.conteo, r.diasDescuento, r.montoDescuento, r.montoPorJustificar)
if (r.conteo.incidencia !== 7 || r.conteo.opero !== 7 || r.conteo.sin_ruta !== 1 || r.montoDescuento !== 700) throw new Error('FALLA')
// incidencia abierta (sin fecha fin) + duplicado entre facturas
const l2 = [...l, { ...l[0], factura_folio: 'F2', factura_fecha: '2026-09-22', inicio: '2026-09-10', dias: 6, fin: '2026-09-15' }]
const r2 = conciliar(l2, [], rutas, u)
console.log(r2.map(x => [x.linea.factura_folio, x.conteo.duplicado]))
if (r2[1].conteo.duplicado !== 6) throw new Error('FALLA dup')
console.log('OK')
