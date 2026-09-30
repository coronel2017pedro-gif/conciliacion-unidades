import { eachDay, diffDays } from './dates'
import type { FacturaLinea, Incidencia, Ruta, Unidad } from './types'

export type EstadoDia =
  | 'duplicado'      // el mismo día de la misma placa ya está cobrado en otra factura vigente
  | 'antes_entrega'  // se cobra antes de la fecha de entrega de la unidad
  | 'incidencia'     // taller / falla / llantas registrado por el dispatcher (descuenta)
  | 'opero'          // hubo ruta ese día
  | 'sin_ruta'       // sin ruta y sin incidencia: por justificar (NO descuenta automáticamente)
  | 'sin_datos'      // no hay reporte de rutas cargado para esa fecha

export const DESCUENTAN: EstadoDia[] = ['duplicado', 'antes_entrega', 'incidencia']

export interface DiaDetalle { fecha: string; estado: EstadoDia; detalle?: string }

export interface ResultadoLinea {
  linea: FacturaLinea
  dias: DiaDetalle[]
  conteo: Record<EstadoDia, number>
  diasCalculados: number
  diasDescuento: number
  montoDescuento: number       // subtotal sin IVA
  montoDescuentoIva: number
  montoPorJustificar: number   // días sin ruta sin justificar (no descuenta aún)
  banderas: string[]
  conInventario: boolean
}

export interface Opciones {
  /** Si true, los días sin ruta y sin incidencia se tratan también como descuento (modo agresivo). */
  descontarSinRuta?: boolean
  iva?: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function conciliar(
  lineas: FacturaLinea[],
  incidencias: Incidencia[],
  rutas: Ruta[],
  unidades: Unidad[],
  opts: Opciones = {},
): ResultadoLinea[] {
  const iva = opts.iva ?? 0.16
  const rutasSet = new Set(rutas.map(r => `${r.placa}|${r.fecha}`))
  let rMin = '9999-12-31', rMax = '0000-01-01'
  for (const r of rutas) { if (r.fecha < rMin) rMin = r.fecha; if (r.fecha > rMax) rMax = r.fecha }
  const hayRutas = rutas.length > 0
  const uni = new Map(unidades.map(u => [u.placa, u]))
  const incPorPlaca = new Map<string, Incidencia[]>()
  for (const i of incidencias) (incPorPlaca.get(i.placa) ?? incPorPlaca.set(i.placa, []).get(i.placa)!).push(i)

  // Orden estable: factura más antigua primero => la posterior es la "duplicada"
  const orden = [...lineas].sort((a, b) =>
    (a.factura_fecha ?? '').localeCompare(b.factura_fecha ?? '') || a.factura_folio.localeCompare(b.factura_folio) || a.linea - b.linea)
  const cobrado = new Map<string, string>() // placa|dia -> folio que lo cobró primero

  const out: ResultadoLinea[] = []
  for (const l of orden) {
    const u = uni.get(l.placa)
    const incs = incPorPlaca.get(l.placa) ?? []
    const conteo: Record<EstadoDia, number> = { duplicado: 0, antes_entrega: 0, incidencia: 0, opero: 0, sin_ruta: 0, sin_datos: 0 }
    const dias: DiaDetalle[] = []
    const banderas: string[] = []
    let fechas = eachDay(l.inicio, l.fin)
    // Convención de BE: en "INICIO DE RENTA dd/mm" el día de entrega no se cobra (10→15 = 5 días).
    if (l.dias === fechas.length - 1) fechas = fechas.slice(1)

    for (const d of fechas) {
      const key = `${l.placa}|${d}`
      let estado: EstadoDia, detalle: string | undefined
      const previo = cobrado.get(key)
      const inc = incs.find(i => i.descuenta && d >= i.fecha_inicio && (i.fecha_fin == null || d <= i.fecha_fin))
      if (previo && previo !== l.factura_folio) { estado = 'duplicado'; detalle = `ya cobrado en ${previo}` }
      else if (u?.fecha_entrega && d < u.fecha_entrega) { estado = 'antes_entrega'; detalle = `entrega ${u.fecha_entrega}` }
      else if (inc) { estado = 'incidencia'; detalle = inc.tipo }
      else if (hayRutas && (d < rMin || d > rMax)) estado = 'sin_datos'
      else if (rutasSet.has(key)) estado = 'opero'
      else estado = hayRutas ? 'sin_ruta' : 'sin_datos'
      if (!previo) cobrado.set(key, l.factura_folio)
      // ruta el mismo día que hay incidencia: contradicción a revisar
      if (estado === 'incidencia' && rutasSet.has(key)) detalle += ' (¡pero hay ruta ese día!)'
      conteo[estado]++
      dias.push({ fecha: d, estado, detalle })
    }

    if (fechas.length !== l.dias) banderas.push(`Facturó ${l.dias} días pero el periodo ${l.inicio}→${l.fin} equivale a ${fechas.length}`)
    if (!u) banderas.push('Placa no está en el inventario de unidades')
    else if (l.plaza && u.plaza && l.plaza.normalize('NFD').replace(/\p{M}/gu, '') !== u.plaza.normalize('NFD').replace(/\p{M}/gu, ''))
      banderas.push(`Factura dice ${l.plaza}, inventario dice ${u.plaza}`)
    if (conteo.duplicado) banderas.push(`${conteo.duplicado} día(s) duplicados con otra factura`)
    if (conteo.antes_entrega) banderas.push(`${conteo.antes_entrega} día(s) cobrados antes de la entrega`)
    if (dias.some(x => x.estado === 'incidencia' && x.detalle?.includes('¡pero hay ruta'))) banderas.push('Hay rutas en días con incidencia registrada')
    if (l.tarifa && l.dias && Math.abs(l.tarifa * l.dias - l.subtotal) > 0.05) banderas.push('Tarifa × días no coincide con el importe')

    let diasDescuento = DESCUENTAN.reduce((s, e) => s + conteo[e], 0)
    if (opts.descontarSinRuta) diasDescuento += conteo.sin_ruta
    out.push({
      linea: l, dias, conteo, diasCalculados: fechas.length, diasDescuento,
      montoDescuento: r2(diasDescuento * l.tarifa),
      montoDescuentoIva: r2(diasDescuento * l.tarifa * (1 + iva)),
      montoPorJustificar: opts.descontarSinRuta ? 0 : r2(conteo.sin_ruta * l.tarifa),
      banderas, conInventario: !!u,
    })
  }
  return out.sort((a, b) => a.linea.factura_folio.localeCompare(b.linea.factura_folio) || a.linea.linea - b.linea.linea)
}

export interface ResumenFactura {
  folio: string; lineas: number; subtotal: number
  diasDescuento: number; descuento: number; porJustificar: number; conBanderas: number
}

export function resumenPorFactura(res: ResultadoLinea[]): ResumenFactura[] {
  const m = new Map<string, ResumenFactura>()
  for (const r of res) {
    const f = m.get(r.linea.factura_folio) ?? { folio: r.linea.factura_folio, lineas: 0, subtotal: 0, diasDescuento: 0, descuento: 0, porJustificar: 0, conBanderas: 0 }
    f.lineas++; f.subtotal = r2(f.subtotal + r.linea.subtotal); f.diasDescuento += r.diasDescuento
    f.descuento = r2(f.descuento + r.montoDescuento); f.porJustificar = r2(f.porJustificar + r.montoPorJustificar)
    if (r.banderas.length) f.conBanderas++
    m.set(f.folio, f)
  }
  return [...m.values()]
}

/** Días consecutivos sin ruta al cierre: ayuda a detectar unidades que "se quedaron paradas". */
export function diasSinRutaAlCierre(placa: string, rutas: Ruta[], cierre: string): number | null {
  let ult: string | null = null
  for (const r of rutas) if (r.placa === placa && r.fecha <= cierre && (!ult || r.fecha > ult)) ult = r.fecha
  return ult ? diffDays(ult, cierre) : null
}

/** Facturas que parecen re-facturación de otra (mismo periodo y mayoría de placas en común). */
export function posiblesRefacturas(lineas: FacturaLinea[]): { nueva: string; anterior: string; comunes: number }[] {
  const porFolio = new Map<string, FacturaLinea[]>()
  for (const l of lineas) (porFolio.get(l.factura_folio) ?? porFolio.set(l.factura_folio, []).get(l.factura_folio)!).push(l)
  const folios = [...porFolio.keys()]
  const out: { nueva: string; anterior: string; comunes: number }[] = []
  for (const a of folios) for (const b of folios) {
    if (a >= b) continue
    const A = porFolio.get(a)!, B = porFolio.get(b)!
    const setA = new Set(A.map(l => `${l.placa}|${l.inicio}|${l.fin}`))
    const comunes = B.filter(l => setA.has(`${l.placa}|${l.inicio}|${l.fin}`)).length
    if (comunes >= Math.max(3, 0.6 * Math.min(A.length, B.length))) out.push({ nueva: b, anterior: a, comunes })
  }
  return out
}
