import fs from 'fs'
import { parseInvoiceItems } from '../src/lib/parseInvoicePdf'
import { pdfItemsNode } from './pdfNode'
const dir = fs.readdirSync('/root/.claude/uploads').map(d => '/root/.claude/uploads/' + d).find(d => fs.readdirSync(d).some(f => f.includes('INV-000906')))!
let n = 0
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.pdf'))) {
  const r = parseInvoiceItems(await pdfItemsNode(dir + '/' + f))
  console.log(f, r.factura.folio, r.factura.fecha, 'subtotal', r.factura.subtotal, 'lineas', r.lineas.length, 'avisos', r.avisos)
  n += r.lineas.length
  if (f.includes('906') || f.includes('937')) console.log(r.lineas.slice(0, 3), r.lineas.slice(-1))
}
console.log('total lineas', n)
