import fs from 'fs'
import * as XLSX from 'xlsx'
import { parseRutas } from '../src/lib/parseExcel'
import { addDays } from '../src/lib/dates'
const dir = fs.readdirSync('/root/.claude/uploads').map(d => '/root/.claude/uploads/' + d).find(d => fs.readdirSync(d).some(f => f.includes('INV-000906')))!
const rd = (f: string) => XLSX.read(fs.readFileSync(dir + '/' + f), { type: 'buffer', cellDates: true })
const rutas = parseRutas(rd(fs.readdirSync(dir).find(f => f.includes('report_carrier'))!))
const cap = XLSX.utils.sheet_to_json<any>(rd(fs.readdirSync(dir).find(f => f.includes('report_capacity'))!).Sheets['Gestion capacidad'])
const porRuta = new Map(rutas.map(r => [r.id_ruta, r]))
let ok = 0, miss = 0; const dif: Record<string, number> = {}
for (const c of cap.filter(c => c['Ejecutado'] === '✓')) {
  const r = porRuta.get(String(c['Id de la ruta']))
  if (!r) { miss++; continue }; ok++
  const d = c['Última actualización'].slice(0, 10)
  const k = String((new Date(d).getTime() - new Date(r.fecha).getTime()) / 86400000); dif[k] = (dif[k] ?? 0) + 1
}
console.log('ejecutadas con ruta en carrier', ok, 'sin match', miss, 'diferencia días (última act - fecha ruta)', dif)
const no = cap.filter(c => c['Ejecutado'] !== '✓')
const est: Record<string, number> = {}
for (const c of no) { const k = ['Solicitado','Confirmado','Asignado','Escaneado'].map(x => c[x] === '✓' ? x[0] : '-').join(''); est[k] = (est[k] ?? 0) + 1 }
console.log('no ejecutadas, estados S C A E:', est)
const fechas = no.map(c => c['Última actualización'].slice(0, 10)); console.log([...new Set(fechas)].sort())
console.log(no.slice(0, 3))
