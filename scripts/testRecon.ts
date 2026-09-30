import fs from 'fs'
import * as XLSX from 'xlsx'
import { parseInvoiceItems } from '../src/lib/parseInvoicePdf'
import { pdfItemsNode } from './pdfNode'
import { parseRutas, parseInventario, parseDesgloseFacturas } from '../src/lib/parseExcel'
import { conciliar, resumenPorFactura } from '../src/lib/reconcile'
const dir = fs.readdirSync('/root/.claude/uploads').map(d => '/root/.claude/uploads/' + d).find(d => fs.readdirSync(d).some(f => f.includes('INV-000906')))!
const rd = (f: string) => XLSX.read(fs.readFileSync(dir + '/' + f), { type: 'buffer', cellDates: true })
const wbR = rd('e55ee605-renta_unidades_01-15_Sep_2026.xlsx')
const rutas = parseRutas(wbR), unidades = parseInventario(wbR)
console.log('rutas', rutas.length, 'unidades', unidades.length)
const desg = parseDesgloseFacturas(rd('cf749593-Desglose_facturas_renta_unidades_sep.xlsx'))
console.log('desglose lineas', desg.length)
let lineas = [...desg]
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.pdf'))) lineas.push(...parseInvoiceItems(await pdfItemsNode(dir + '/' + f)).lineas)
// Comparación PDF vs Excel para folios comunes
const pdfs = lineas.filter(l => !desg.includes(l))
for (const p of pdfs.filter(l => l.factura_folio !== 'INV-000937')) {
  const e = desg.find(d => d.factura_folio === p.factura_folio && d.placa === p.placa)
  if (!e || e.inicio !== p.inicio || e.fin !== p.fin || Math.abs(e.subtotal - p.subtotal) > 0.01) console.log('DIFF', p, e)
}
console.log('PDF vs Excel: revisado', pdfs.length)
const use = lineas.filter(l => l.factura_folio !== 'INV-000863' || false) // 937 sustituye a 863 (a confirmar)
const res = conciliar(desg.filter(d => d.factura_folio !== 'INV-000863').concat(pdfs.filter(p => p.factura_folio === 'INV-000937')), [], rutas, unidades)
console.log(resumenPorFactura(res))
for (const r of res.filter(r => r.banderas.length)) console.log(r.linea.factura_folio, r.linea.placa, r.linea.plaza, r.banderas, r.conteo)
const tot = res.reduce((s, r) => s + r.montoPorJustificar, 0); console.log('por justificar', tot)

import { posiblesRefacturas } from '../src/lib/reconcile'
console.log('refacturas', posiblesRefacturas(lineas))
console.log('SU1684E', res.filter(r=>r.linea.placa==='SU1684E').map(r=>[r.linea.factura_folio,r.conteo]))
import { generarReporte } from '../src/lib/exportXlsx'
import { parseCapacidad, parsePrefacturasML } from '../src/lib/parseExcel'
const capF = fs.readdirSync(dir).find(f => f.includes('report_capacity'))!
const capacidad = parseCapacidad(rd(capF))
// Incidencias de ejemplo para ver el reporte con reclamo (solo demostración)
const incEj: any[] = [{ id: 'x1', placa: res[3].linea.placa, tipo: 'taller', fecha_inicio: '2026-09-05', fecha_fin: '2026-09-08', descuenta: true, plaza: res[3].linea.plaza, plaza_destino: null, notas: 'Ejemplo de demostración', creado_en: '2026-09-09T10:00:00Z' }]
const resEj = conciliar(desg.filter(d => d.factura_folio !== 'INV-000863').concat(pdfs.filter(p => p.factura_folio === 'INV-000937')), incEj, rutas, unidades)
const facturas: any[] = [...new Set(lineas.map(l => l.factura_folio))].map(fo => { const ls = lineas.filter(l => l.factura_folio === fo); const sub = ls.reduce((s, l) => s + l.subtotal, 0); return { folio: fo, fecha: ls[0].factura_fecha, subtotal: sub, iva: sub * 0.16, total: sub * 1.16, folio_fiscal: null } })
const prefs = [...new Map(['6301c897-Prefacturas.csv', '602d9cf8-Prefacturas_1.csv'].flatMap(f => parsePrefacturasML(fs.readFileSync(dir + '/' + f, 'utf8'))).map(p => [p.id_prefactura, p])).values()]
console.log('prefacturas', prefs.length)
const blob = await generarReporte({ prefacturas: prefs, res: resEj, resumen: resumenPorFactura(resEj), facturas, unidades, incidencias: incEj, capacidad, modoAgresivo: false })
fs.writeFileSync('/home/claude/Conciliacion_ejemplo_01-15_sep.xlsx', Buffer.from(await blob.arrayBuffer()))
console.log('ok reporte')
