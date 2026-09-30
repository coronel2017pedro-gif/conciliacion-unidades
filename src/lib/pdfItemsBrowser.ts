import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageItems } from './parseInvoicePdf'
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function pdfItems(buf: ArrayBuffer): Promise<PageItems[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const out: PageItems[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    out.push((tc.items as any[]).filter(i => i.str?.trim()).map(i => ({ str: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number })))
  }
  return out
}
