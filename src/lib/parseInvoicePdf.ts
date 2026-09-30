import { parseFechaEs, iso, normPlaca } from './dates'
import type { Factura, FacturaLinea } from './types'

export interface TextItem { str: string; x: number; y: number }
export type PageItems = TextItem[]

const num = (s: string) => parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0
const PLAZAS = ['IRAPUATO', 'CELAYA', 'MORELIA', 'ZACATECAS', 'AGUASCALIENTES', 'ZAMORA', 'LEON', 'LEÓN', 'SALAMANCA', 'QUERETARO', 'QUERÉTARO', 'GUADALAJARA', 'SAN LUIS POTOSI']

interface Col { key: string; x: number }

/**
 * Parsea una factura de renta (formato BE ARRENDADORA) a partir de los fragmentos de texto
 * posicionados que devuelve pdf.js. La tabla viene "rota" en fragmentos por columna, así que
 * se reconstruye con las posiciones X de los encabezados.
 */
export function parseInvoiceItems(pages: PageItems[]): { factura: Factura; lineas: FacturaLinea[]; avisos: string[] } {
  const avisos: string[] = []
  const all = pages.flat()
  const text = all.map(i => i.str).join(' ').replace(/\s+/g, ' ')

  const folio = text.match(/Folio\s+(INV-\d+)/)?.[1] ?? ''
  const fecha = parseFechaEs(text.match(/Fecha de la factura\s*:\s*(\d{1,2}\s+\w+\s+\d{4})/)?.[1] ?? '')
  const folioFiscal = text.match(/Folio fiscal\s*:\s*([0-9a-f-]{36})/i)?.[1] ?? null
  const subtotal = num(text.match(/Subtotal\s+([\d,]+\.\d{2})/)?.[1] ?? '0')
  const iva = num(text.match(/\(16%\)\s+([\d,]+\.\d{2})/)?.[1] ?? '0')
  const total = num(text.match(/Total\s+MXN\s?([\d,]+\.\d{2})/)?.[1] ?? '0')
  if (!folio) avisos.push('No se encontró el folio de la factura.')

  // Encabezados de la primera página con tabla
  const p0 = pages.find(p => p.some(i => i.str.trim() === 'Placa')) ?? pages[0]
  const hx = (re: RegExp) => p0.find(i => re.test(i.str.trim()))
  const hdr = {
    art: hx(/^Artículo/), veh: hx(/^Vehíc/), placa: hx(/^Placa$/), serie: hx(/^No de$/),
    desde: hx(/^Perio$/), hasta: undefined as TextItem | undefined, dias: hx(/^Días$/),
    cod: hx(/^Código$/), cant: hx(/^Cant\.$/), tarifa: hx(/^Tarifa$/), importe: hx(/^Cantidad$/),
  }
  const perios = p0.filter(i => i.str.trim() === 'Perio').sort((a, b) => a.x - b.x)
  hdr.desde = perios[0]; hdr.hasta = perios[1]
  if (Object.values(hdr).some(v => !v)) {
    avisos.push('No se reconoció el encabezado de la tabla; el formato de la factura cambió.')
    return { factura: { folio, fecha, proveedor: 'BE ARRENDADORA', subtotal, iva, total, folio_fiscal: folioFiscal }, lineas: [], avisos }
  }
  const cols: Col[] = [
    { key: 'art', x: hdr.art!.x }, { key: 'veh', x: hdr.veh!.x }, { key: 'placa', x: hdr.placa!.x },
    { key: 'serie', x: hdr.serie!.x }, { key: 'desde', x: hdr.desde!.x }, { key: 'hasta', x: hdr.hasta!.x },
    { key: 'dias', x: hdr.dias!.x }, { key: 'cod', x: hdr.cod!.x }, { key: 'cant', x: hdr.cant!.x },
    { key: 'tarifa', x: hdr.tarifa!.x }, { key: 'importe', x: hdr.importe!.x },
  ].sort((a, b) => a.x - b.x)
  const colOf = (x: number) => {
    let k = cols[0].key
    for (const c of cols) if (x >= c.x - 8) k = c.key
    return k
  }
  const anchorX = hdr.art!.x - 12

  // Filas: un ancla numérica en la columna "#" por cada concepto
  type Row = { n: number; y: number; page: number; items: TextItem[] }
  const rows: Row[] = []
  const headerY = hdr.art!.y + 20
  pages.forEach((items, pi) => {
    const isHdrPage = items === p0
    const sub = items.find(i => /^Subtotal$/.test(i.str.trim()))
    const yMax = isHdrPage ? headerY - 30 : 1e9
    const yMin = sub ? sub.y + 5 : 50 // 50 = margen inferior (evita el número de página)
    const body = items.filter(i => i.y < yMax && i.y > yMin && i.str.trim())
    const anchors = body.filter(i => i.x < anchorX + 18 && /^\d+$/.test(i.str.trim()))
      .sort((a, b) => b.y - a.y)
    anchors.forEach((a, k) => {
      const yTop = a.y + 6
      const yBot = k + 1 < anchors.length ? anchors[k + 1].y + 6 : yMin
      rows.push({ n: +a.str.trim(), y: a.y, page: pi, items: body.filter(i => i.y <= yTop && i.y > yBot && i !== a) })
    })
  })

  const lineas: FacturaLinea[] = []
  for (const r of rows) {
    const byCol: Record<string, string[]> = {}
    const sorted = [...r.items].sort((a, b) => b.y - a.y || a.x - b.x)
    for (const it of sorted) (byCol[colOf(it.x)] ??= []).push(it.str.trim())
    const j = (k: string, sep = '') => (byCol[k] ?? []).join(sep)
    const desc = j('art', ' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ')
    const inicio = parseFechaEs(j('desde', ' '))
    const fin = parseFechaEs(j('hasta', ' '))
    const placa = normPlaca(j('placa'))
    if (!inicio || !fin || !placa) { avisos.push(`Concepto ${r.n} incompleto (placa/periodo); revisar manualmente.`); continue }
    const expl = desc.match(/INICIO DE RENTA\s*(\d{2})\/(\d{2})\/(\d{2})/i)
    const plaza = PLAZAS.find(p => new RegExp(`(^|[^A-ZÁÉÍÓÚ])${p}([^A-ZÁÉÍÓÚ]|$)`, 'i').test(desc.toUpperCase())) ?? null
    const tarifa = num(j('tarifa'))
    lineas.push({
      factura_folio: folio, factura_fecha: fecha, linea: r.n,
      placa, serie: j('serie') || null,
      vehiculo: j('veh').replace(/\s+/g, '') || null,
      plaza: plaza ? plaza.replace('LEON', 'LEÓN').replace('QUERETARO', 'QUERÉTARO') : null,
      inicio, fin, dias: parseInt(j('dias')) || 0, tarifa, subtotal: num(j('importe')),
      inicio_explicito: !!expl,
    })
  }
  lineas.sort((a, b) => a.linea - b.linea)
  const sumLin = Math.round(lineas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100
  if (lineas.length && subtotal && Math.abs(sumLin - subtotal) > 0.05)
    avisos.push(`La suma de los conceptos (${sumLin.toFixed(2)}) no coincide con el subtotal de la factura (${subtotal.toFixed(2)}); revisar que se hayan leído todos los renglones.`)
  return { factura: { folio, fecha, proveedor: 'BE ARRENDADORA', subtotal, iva, total, folio_fiscal: folioFiscal }, lineas, avisos }
}
