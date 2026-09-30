import fs from 'fs'
import * as XLSX from 'xlsx'
import { parseRutas } from '../src/lib/parseExcel'
const dir = fs.readdirSync('/root/.claude/uploads').map(d => '/root/.claude/uploads/' + d).find(d => fs.readdirSync(d).some(f => f.includes('INV-000906')))!
const rd = (f: string) => XLSX.read(fs.readFileSync(dir + '/' + f), { type: 'buffer', cellDates: true })
const carrierF = fs.readdirSync(dir).find(f => f.includes('report_carrier'))!
const rentaF = fs.readdirSync(dir).find(f => f.includes('renta_unidades_01-15'))!
let a: any[] = []
try { a = parseRutas(rd(carrierF)) } catch (e: any) { console.log('carrier parse error:', e.message) }
const b = parseRutas(rd(rentaF))
console.log('carrier', a.length, 'renta', b.length)
const fmt = (r: any) => `${r.fecha}|${r.placa}|${r.id_ruta}`
const A = new Set(a.map(fmt)), B = new Set(b.map(fmt))
console.log('solo en carrier', [...A].filter(x => !B.has(x)).length, 'solo en renta', [...B].filter(x => !A.has(x)).length)
console.log('fechas carrier', a.map(r => r.fecha).sort()[0], a.map(r => r.fecha).sort().at(-1), 'placas', new Set(a.map(r => r.placa)).size)
console.log(a.slice(0, 3), b.slice(0, 3))
// capacity
const capF = fs.readdirSync(dir).find(f => f.includes('report_capacity'))!
const cap = XLSX.utils.sheet_to_json<any>(rd(capF).Sheets['Gestion capacidad'])
console.log('capacity rows', cap.length, 'ejecutado', cap.filter(r => r['Ejecutado'] === '✓').length, 'escaneado', cap.filter(r => r['Escaneado'] === '✓').length)
const noEj = cap.filter(r => r['Ejecutado'] !== '✓')
console.log('no ejecutados', noEj.length, noEj.slice(0, 8).map(r => [r['Placa'], r['Id de la ruta'], r['Solicitado'], r['Confirmado'], r['Asignado'], r['Escaneado'], r['Ejecutado']]))
