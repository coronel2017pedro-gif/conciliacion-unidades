import fs from 'fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageItems } from '../src/lib/parseInvoicePdf'
export async function pdfItemsNode(file: string): Promise<PageItems[]> {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise
  const out: PageItems[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    out.push((tc.items as any[]).filter(i => i.str?.trim()).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })))
  }
  return out
}
