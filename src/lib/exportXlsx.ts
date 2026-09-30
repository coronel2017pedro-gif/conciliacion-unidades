// Reporte de conciliación en Excel con el mismo formato que el "Desglose de facturas" del arrendador:
// título, encabezados azul marino, renglones alternados y hojas Resumen / Detalle rentas / Inicio por placas,
// más las hojas de reclamo, incidencias y detalle por día.
import type { Capacidad, Factura, FacturaLinea, Incidencia, PrefacturaML, Unidad } from './types'
import { TIPOS_INCIDENCIA } from './types'
import { DESCUENTAN, posiblesRefacturas, type ResultadoLinea, type ResumenFactura } from './reconcile'

export interface DatosReporte {
  res: ResultadoLinea[]
  resumen: ResumenFactura[]
  facturas: Factura[]
  unidades: Unidad[]
  incidencias: Incidencia[]
  capacidad?: Capacidad[]
  prefacturas?: PrefacturaML[]
  modoAgresivo: boolean
  proveedor?: string
  cliente?: string
}

const ESTADO_TXT: Record<string, string> = {
  duplicado: 'Duplicado', antes_entrega: 'Antes de entrega', incidencia: 'Incidencia', opero: 'Operó', sin_ruta: 'Sin ruta (por justificar)', sin_datos: 'Sin datos de rutas',
}
const NAVY = 'FF1F3864', AZUL = 'FFBDD7EE', BANDA = 'FFD6E4F0', AMBAR = 'FFFFC000', DURAZNO = 'FFFCE4D6', BLANCO = 'FFFFFFFF', GRIS = 'FF595959'
const MONEDA = '"$"#,##0.00', FECHA = 'dd/mm/yyyy'
const r2 = (n: number) => Math.round(n * 100) / 100
const fecha = (iso?: string | null) => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const dmy = (iso: string) => iso.split('-').reverse().join('/')

export async function generarReporte(d: DatosReporte): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Conciliación de unidades'; wb.created = new Date()

  const proveedor = d.proveedor ?? 'BE ARRENDADORA', cliente = d.cliente ?? 'SEND LINE LOGISTICOS'
  const lineas = d.res.map(r => r.linea)
  const uni = new Map(d.unidades.map(u => [u.placa, u]))
  const fac = new Map(d.facturas.map(f => [f.folio, f]))
  const ini = lineas.reduce((m, l) => (l.inicio < m ? l.inicio : m), '9999-12-31'), fin = lineas.reduce((m, l) => (l.fin > m ? l.fin : m), '0000-01-01')
  const periodo = lineas.length ? `Periodo ${dmy(ini)} al ${dmy(fin)}` : ''
  // Reporte de capacidad (informativo): unidad solicitada/asignada que no salió a ruta, dentro del periodo facturado
  const hayCap = (d.capacidad?.length ?? 0) > 0
  const finMas1 = fin < '9999' ? new Date(Date.UTC(+fin.slice(0, 4), +fin.slice(5, 7) - 1, +fin.slice(8, 10) + 1)).toISOString().slice(0, 10) : fin
  const capNoEj = (d.capacidad ?? []).filter(c => !c.ejecutado && (c.solicitado || c.confirmado || c.asignado) && c.actualizado.slice(0, 10) >= ini && c.actualizado.slice(0, 10) <= finMas1)
  const capPorPlaca = new Map<string, Capacidad[]>()
  for (const c of capNoEj) (capPorPlaca.get(c.placa) ?? capPorPlaca.set(c.placa, []).get(c.placa)!).push(c)
  // Ingreso de Mercado Libre (prefacturas) vs renta facturada, por quincena (YYYYMMQ1 = 1-15, Q2 = 16 a fin de mes)
  const prefs = (d.prefacturas ?? []).filter(p => !/cancel|rechaz/i.test(p.estado ?? ''))
  const hayPref = prefs.length > 0
  const quin = (iso: string) => `${iso.slice(0, 4)}${iso.slice(5, 7)}Q${+iso.slice(8, 10) <= 15 ? 1 : 2}`
  const rangoQuin = (q: string): [string, string] => {
    const y = +q.slice(0, 4), m = +q.slice(4, 6), ult = new Date(Date.UTC(y, m, 0)).getUTCDate(), mm = String(m).padStart(2, '0')
    return q.endsWith('Q1') ? [`${y}-${mm}-01`, `${y}-${mm}-15`] : [`${y}-${mm}-16`, `${y}-${mm}-${ult}`]
  }
  interface Quin { q: string; regular: number; compl: number; estados: Set<string>; renta: number; reclamo: number; justificar: number }
  const porQuin = new Map<string, Quin>()
  const getQ = (q: string) => porQuin.get(q) ?? (porQuin.set(q, { q, regular: 0, compl: 0, estados: new Set(), renta: 0, reclamo: 0, justificar: 0 }), porQuin.get(q)!)
  for (const p of prefs) { const o = getQ(p.periodo); if (/regular/i.test(p.tipo)) o.regular += p.total; else o.compl += p.total; if (p.estado) o.estados.add(p.estado) }
  for (const r of d.res) for (const x of r.dias) {
    const o = getQ(quin(x.fecha)); o.renta += r.linea.tarifa
    if (DESCUENTAN.includes(x.estado) || (d.modoAgresivo && x.estado === 'sin_ruta')) o.reclamo += r.linea.tarifa
    else if (x.estado === 'sin_ruta') o.justificar += r.linea.tarifa
  }
  const todas = [...porQuin.values()].sort((a, b) => a.q.localeCompare(b.q))
  // En la hoja: quincenas con renta facturada y las 4 anteriores como referencia histórica
  const primera = todas.findIndex(o => o.renta > 0)
  const quincenas = primera < 0 ? todas.slice(-6) : todas.slice(Math.max(0, primera - 4))
  const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const titulo = (ws: import('exceljs').Worksheet, texto: string, sub: string, ncols: number) => {
    ws.getCell('A2').value = texto; ws.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: NAVY } }
    ws.getCell('A3').value = sub; ws.getCell('A3').font = { name: 'Arial', size: 10, italic: true, color: { argb: GRIS } }
    ws.getRow(2).height = 24
    ws.views = [{ showGridLines: false }]
    void ncols
  }
  const encabezado = (ws: import('exceljs').Worksheet, fila: number, cols: string[]) => {
    const row = ws.getRow(fila)
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = c
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: BLANCO } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = { top: { style: 'thin', color: { argb: BLANCO } }, bottom: { style: 'thin', color: { argb: BLANCO } }, left: { style: 'thin', color: { argb: BLANCO } }, right: { style: 'thin', color: { argb: BLANCO } } }
    })
    row.height = 30
  }
  type Fmt = string | undefined
  const filas = (ws: import('exceljs').Worksheet, desde: number, datos: unknown[][], fmts: Fmt[], color?: (i: number) => string | undefined) => {
    datos.forEach((vals, i) => {
      const row = ws.getRow(desde + i)
      const relleno = color?.(i) ?? (i % 2 === 0 ? AZUL : BLANCO)
      vals.forEach((v, j) => {
        const c = row.getCell(j + 1)
        c.value = v as never
        c.font = { name: 'Arial', size: 10 }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: relleno } }
        if (fmts[j]) c.numFmt = fmts[j]!
        c.alignment = { vertical: 'middle', horizontal: typeof v === 'number' || v instanceof Date ? 'right' : 'left', wrapText: typeof v === 'string' && v.length > 40 }
        c.border = { bottom: { style: 'hair', color: { argb: 'FF9DB7D5' } } }
      })
    })
  }
  const totalFila = (ws: import('exceljs').Worksheet, fila: number, vals: unknown[], fmts: Fmt[]) => {
    const row = ws.getRow(fila)
    vals.forEach((v, j) => {
      const c = row.getCell(j + 1)
      c.value = v as never
      c.font = { name: 'Arial', size: 10, bold: true, color: { argb: NAVY } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BANDA } }
      if (fmts[j]) c.numFmt = fmts[j]!
      c.alignment = { horizontal: typeof v === 'number' ? 'right' : 'left' }
      c.border = { top: { style: 'thin', color: { argb: NAVY } } }
    })
  }
  const anchos = (ws: import('exceljs').Worksheet, w: number[]) => w.forEach((x, i) => { ws.getColumn(i + 1).width = x })

  // ============ 1. RESUMEN ============
  const rs = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: NAVY } } })
  titulo(rs, 'Conciliación de rentas por factura', `Facturas emitidas por ${proveedor} a ${cliente} · ${periodo} · Generado el ${hoy}`, 12)
  const colsRes = ['Factura', 'Fecha factura', 'Conceptos', 'Placas únicas', 'Subtotal', 'IVA', 'Total', 'Folio fiscal', 'Días a reclamar', 'Reclamo sin IVA', 'Reclamo con IVA', 'Por justificar (sin IVA)']
  encabezado(rs, 5, colsRes)
  const fmtRes: Fmt[] = [undefined, FECHA, '0', '0', MONEDA, MONEDA, MONEDA, undefined, '0', MONEDA, MONEDA, MONEDA]
  const placasPorFolio = (folio: string) => new Set(lineas.filter(l => l.factura_folio === folio).map(l => l.placa)).size
  const datosRes = d.resumen.map(f => {
    const F = fac.get(f.folio)
    const sub = F?.subtotal ?? f.subtotal, iva = F?.iva ?? r2(sub * 0.16), tot = F?.total ?? r2(sub + iva)
    return [f.folio, fecha(F?.fecha ?? lineas.find(l => l.factura_folio === f.folio)?.factura_fecha), f.lineas, placasPorFolio(f.folio), sub, iva, tot, F?.folio_fiscal ?? '',
      f.diasDescuento, f.descuento, r2(f.descuento * 1.16), f.porJustificar]
  })
  filas(rs, 6, datosRes, fmtRes)
  const sum = (i: number) => r2(datosRes.reduce((s, r) => s + (Number(r[i]) || 0), 0))
  const fT = 6 + datosRes.length
  totalFila(rs, fT, ['TOTAL', null, sum(2), new Set(lineas.map(l => l.placa)).size, sum(4), sum(5), sum(6), '', sum(8), sum(9), sum(10), sum(11)], fmtRes)

  // Controles
  let f = fT + 2
  encabezado(rs, f, ['Control', 'Resultado', 'Detalle', '', 'Acción sugerida', '', '', ''])
  rs.mergeCells(f, 3, f, 4); rs.mergeCells(f, 5, f, 8)
  f++
  const totCnt = (k: keyof ResultadoLinea['conteo']) => d.res.reduce((s, r) => s + r.conteo[k], 0)
  const listaPlacas = (k: keyof ResultadoLinea['conteo']) => {
    const l = d.res.filter(r => r.conteo[k] > 0).map(r => `${r.linea.placa} (${r.conteo[k]})`)
    return l.length > 8 ? `${l.slice(0, 8).join(', ')} y ${l.length - 8} más (ver Detalle rentas)` : l.join(', ')
  }
  const dupPlacas = new Map<string, Set<string>>()
  for (const l of lineas) (dupPlacas.get(l.placa) ?? dupPlacas.set(l.placa, new Set()).get(l.placa)!).add(l.factura_folio)
  const repetidas = [...dupPlacas.entries()].filter(([, s]) => s.size > 1)
  const fueraInv = [...new Set(d.res.filter(r => !r.conInventario).map(r => r.linea.placa))]
  const conObs = d.res.filter(r => r.banderas.length).length
  const refacts = posiblesRefacturas(lineas)
  const incDias = totCnt('incidencia'), sinRuta = totCnt('sin_ruta'), sinDatos = totCnt('sin_datos')
  const montoSinRuta = r2(d.res.reduce((s, r) => s + r.conteo.sin_ruta * r.linea.tarifa, 0))
  const controles: [string, number | string, string, string, boolean][] = [
    ['Total de conceptos', lineas.length, `${lineas.length} conceptos de ${d.resumen.length} factura(s) conciliados`, 'Sin acción', false],
    ['Placas distintas', new Set(lineas.map(l => l.placa)).size, repetidas.length ? `${repetidas.length} placa(s) se repiten entre facturas: ${repetidas.map(([p, s]) => `${p} (${[...s].join(' y ')})`).join('; ')}` : 'Ninguna placa se repite entre facturas', repetidas.length ? 'Validar plaza y posible cobro duplicado' : 'Sin acción', repetidas.length > 0],
    ['Días cobrados duplicados', totCnt('duplicado'), totCnt('duplicado') ? listaPlacas('duplicado') : 'Ninguno', totCnt('duplicado') ? 'Reclamar: el mismo día de la misma placa aparece en otra factura' : 'Sin acción', totCnt('duplicado') > 0],
    ['Días cobrados antes de la entrega', totCnt('antes_entrega'), totCnt('antes_entrega') ? listaPlacas('antes_entrega') : 'Ninguno', totCnt('antes_entrega') ? 'Reclamar: la unidad no había sido entregada' : 'Sin acción', totCnt('antes_entrega') > 0],
    ['Días con incidencia registrada', incDias, incDias ? listaPlacas('incidencia') : 'Ninguno (los dispatchers no han registrado taller/falla/llantas)', incDias ? 'Reclamar: unidad en taller, falla o llantas imputable al arrendador' : 'Pedir a los dispatchers que registren incidencias', incDias > 0],
    [d.modoAgresivo ? 'Días sin ruta (incluidos en el reclamo)' : 'Días sin ruta por justificar', sinRuta, sinRuta ? `${listaPlacas('sin_ruta')} · ${d.modoAgresivo ? 'ya descontados' : `equivalen a ${montoSinRuta.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} sin IVA`}` : sinDatos ? `${sinDatos} día(s) sin reporte de rutas cargado` : 'Ninguno', sinRuta ? 'Los dispatchers deben justificar cada día (taller, falla, sin operador). Lo no justificado se acepta como cobro válido' : 'Sin acción', sinRuta > 0],
    ...(hayCap ? [(() => {
      const fact = new Set(lineas.map(l => l.placa))
      const lst = [...capPorPlaca.entries()].filter(([p]) => fact.has(p)).map(([p, c]) => `${p} (${c.length})`)
      const n = lst.reduce((sN, x) => sN + Number(x.match(/\((\d+)\)/)![1]), 0)
      return ['Solicitadas o asignadas sin ejecutar (capacidad)', n, n ? `${lst.length > 8 ? `${lst.slice(0, 8).join(', ')} y ${lst.length - 8} más` : lst.join(', ')} · informativo, no cambia los montos` : 'Ninguna unidad facturada quedó solicitada o asignada sin salir a ruta', n ? 'Preguntar al dispatcher el motivo; si fue falla o taller del arrendador, registrar la incidencia' : 'Sin acción', n > 0] as [string, number | string, string, string, boolean]
    })()] : []),
    ...(hayPref ? [(() => {
      const facts = quincenas.filter(o => o.renta > 0 && (o.regular + o.compl) > 0)
      const ing = r2(facts.reduce((t, o) => t + o.regular + o.compl, 0)), ren = r2(facts.reduce((t, o) => t + o.renta - o.reclamo, 0))
      const pct = ing ? `${((ren / ing) * 100).toFixed(1)}%` : 'n/d'
      const sinIng = quincenas.filter(o => o.renta > 0 && (o.regular + o.compl) === 0).map(o => o.q)
      return ['Ingreso ML vs renta neta', pct, facts.length ? `Renta neta ${ren.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} sobre ingreso ML ${ing.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} (${facts.map(o => o.q).join(', ')}). Ver hoja «Ingreso vs renta»${sinIng.length ? ` · sin prefactura aún: ${sinIng.join(', ')}` : ''}` : `Hay prefacturas, pero ninguna quincena coincide con los días facturados${sinIng.length ? ` (sin prefactura: ${sinIng.join(', ')})` : ''}`, 'Informativo: el ingreso ML incluye toda la operación del transportista, no solo las unidades rentadas', false] as [string, number | string, string, string, boolean]
    })()] : []),
    ['Conceptos con observaciones', conObs, conObs ? 'Ver columna Observaciones en Detalle rentas' : 'Ninguno', conObs ? 'Revisar concepto por concepto' : 'Sin acción', conObs > 0],
    ['Placas fuera del inventario', fueraInv.length, fueraInv.length ? fueraInv.join(', ') : 'Todas las placas están en el inventario', fueraInv.length ? 'Confirmar si la unidad existe y a qué plaza pertenece' : 'Sin acción', fueraInv.length > 0],
    ...refacts.map(r => ['Posible refacturación', r.nueva, `${r.nueva} coincide en ${r.comunes} placa(s) y periodo con ${r.anterior}`, `Confirmar con el arrendador si ${r.anterior} fue sustituida o cancelada`, true] as [string, string, string, string, boolean]),
  ]
  controles.forEach(([a, b, c, acc, hallazgo]) => {
    const row = rs.getRow(f)
    ;[[1, a], [2, b], [3, c], [5, acc]].forEach(([col, v]) => {
      const cell = row.getCell(col as number); cell.value = v as never
      cell.font = { name: 'Arial', size: 10, bold: col === 1 }
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: col === 2 ? 'center' : 'left' }
    })
    rs.mergeCells(f, 3, f, 4); rs.mergeCells(f, 5, f, 8)
    for (let col = 1; col <= 8; col++) {
      const cell = row.getCell(col)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hallazgo ? DURAZNO : BLANCO } }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FF9DB7D5' } } }
    }
    row.height = Math.max(18, Math.ceil(Math.max(String(c).length / 75, acc.length / 85)) * 15)
    f++
  })

  // Criterio
  f++
  rs.mergeCells(f, 1, f, 8)
  const banda = rs.getCell(f, 1); banda.value = 'Criterio de conciliación'
  banda.font = { name: 'Arial', size: 11, bold: true, color: { argb: NAVY } }
  banda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BANDA } }
  f++
  rs.mergeCells(f, 1, f, 8)
  const crit = rs.getCell(f, 1)
  crit.value = [
    'Se compara, día por día y placa por placa, lo que factura el arrendador contra la operación real.',
    'Se reclaman: (1) días de la misma placa cobrados en más de una factura, (2) días cobrados antes de la fecha de entrega de la unidad y (3) días con una incidencia registrada por el dispatcher como responsabilidad del arrendador (taller, falla, llantas, siniestro).',
    'En las facturas con "INICIO DE RENTA" el día de entrega no se cobra (10 al 15 = 5 días).',
    d.modoAgresivo
      ? 'Modo agresivo activo: los días sin ruta y sin incidencia también se incluyen en el reclamo.'
      : 'Los días sin ruta y sin incidencia registrada NO se reclaman: quedan "por justificar" hasta que el dispatcher registre el motivo.',
  ].join('\n')
  crit.alignment = { wrapText: true, vertical: 'top' }; crit.font = { name: 'Arial', size: 10 }
  rs.getRow(f).height = 92
  anchos(rs, [34, 16, 14, 46, 15, 14, 15, 38, 14, 16, 16, 18])

  // ============ 1a. INGRESO VS RENTA ============
  if (hayPref) {
    const iv = wb.addWorksheet('Ingreso vs renta', { properties: { tabColor: { argb: 'FF00B050' } } })
    titulo(iv, 'Ingreso de Mercado Libre vs renta de unidades', `Prefacturas de pago de Mercado Libre contra la renta facturada por ${proveedor}, por quincena · importes sin IVA · Generado el ${hoy}`, 13)
    encabezado(iv, 5, ['Quincena', 'Del', 'Al', 'Ingreso ML (prefactura regular)', 'Complementarias / controles', 'Ingreso ML total', 'Estado de pago', 'Renta facturada', 'Reclamo al arrendador', 'Renta neta', '% renta / ingreso', '% renta neta / ingreso', 'Ingreso menos renta neta', 'Por justificar (sin IVA)'])
    const fmtIv: Fmt[] = [undefined, FECHA, FECHA, MONEDA, MONEDA, MONEDA, undefined, MONEDA, MONEDA, MONEDA, '0.0%', '0.0%', MONEDA, MONEDA]
    const filasIv = quincenas.map((o, i) => {
      const [a, b] = rangoQuin(o.q), fr = 6 + i, ing = r2(o.regular + o.compl)
      return [o.q, fecha(a), fecha(b), r2(o.regular), r2(o.compl), { formula: `D${fr}+E${fr}`, result: ing }, [...o.estados].join(' / '), r2(o.renta), r2(o.reclamo),
        { formula: `H${fr}-I${fr}`, result: r2(o.renta - o.reclamo) }, ing && o.renta ? { formula: `H${fr}/F${fr}`, result: o.renta / ing } : null, ing && o.renta ? { formula: `J${fr}/F${fr}`, result: (o.renta - o.reclamo) / ing } : null,
        ing ? { formula: `F${fr}-J${fr}`, result: r2(ing - (o.renta - o.reclamo)) } : null, r2(o.justificar)]
    })
    filas(iv, 6, filasIv, fmtIv, i => (quincenas[i].renta === 0 ? BLANCO : quincenas[i].regular + quincenas[i].compl === 0 ? DURAZNO : i % 2 === 0 ? AZUL : BLANCO))
    const nq = quincenas.length, sm = (c: string) => ({ formula: `SUM(${c}6:${c}${5 + nq})`, result: 0 })
    totalFila(iv, 6 + nq, ['TOTAL', null, null, sm('D'), sm('E'), sm('F'), '', sm('H'), sm('I'), sm('J'), null, null, null, sm('N')], fmtIv)
    let g = 8 + nq
    iv.mergeCells(g, 1, g, 14)
    const nota = iv.getCell(g, 1)
    nota.value = [
      'Cómo leerlo: el ingreso es lo que Mercado Libre paga al transportista por la quincena (prefactura regular + complementarias; las negativas son descuentos que aplica ML, p. ej. «Controles Internos»).',
      'La renta es lo que factura el arrendador por los días de esa quincena; el reclamo se resta para obtener la renta neta. «% renta / ingreso» indica qué parte del ingreso se va en renta.',
      'El ingreso de ML cubre toda la operación del transportista, no solo las unidades rentadas: la comparación es de control (tendencia), no un cruce ruta por ruta.',
      'Las filas en durazno tienen renta facturada pero aún no hay prefactura de ML de esa quincena; las filas sin renta son quincenas anteriores con solo ingreso.',
      'La quincena vigente puede mostrar una prefactura «En progreso»: su importe cambia hasta el cierre.',
    ].join('\n')
    nota.alignment = { wrapText: true, vertical: 'top' }; nota.font = { name: 'Arial', size: 10 }
    iv.getRow(g).height = 88
    anchos(iv, [12, 12, 12, 20, 18, 18, 24, 17, 17, 17, 12, 13, 18, 17])
    iv.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]
  }

  // ============ 1b. POR PLAZA Y MOTIVO ============
  const pp = wb.addWorksheet('Por plaza y motivo', { properties: { tabColor: { argb: 'FF2E75B6' } } })
  titulo(pp, 'Reclamo por plaza y por motivo', `Cuánto se reclama en cada plaza y a qué se debe · ${periodo}`, 14)
  const plazaDe = (r: ResultadoLinea) => (uni.get(r.linea.placa)?.plaza ?? r.linea.plaza ?? 'SIN PLAZA').toUpperCase()
  // Motivos: duplicado, antes de entrega, cada tipo de incidencia usado, y sin ruta (si el modo agresivo la descuenta)
  const tiposUsados = [...new Set(d.res.flatMap(r => r.dias.filter(x => x.estado === 'incidencia').map(x => (x.detalle ?? 'otro').split(' ')[0])))]
  const nombreTipo = (t: string) => TIPOS_INCIDENCIA.find(x => x.v === t)?.l ?? t
  type Motivo = { clave: string; etiqueta: string; ok: (x: { estado: string; detalle?: string }) => boolean }
  const motivos: Motivo[] = [
    { clave: 'duplicado', etiqueta: 'Duplicado en otra factura', ok: x => x.estado === 'duplicado' },
    { clave: 'antes_entrega', etiqueta: 'Cobrado antes de la entrega', ok: x => x.estado === 'antes_entrega' },
    ...tiposUsados.map(t => ({ clave: 'inc_' + t, etiqueta: `Incidencia: ${nombreTipo(t)}`, ok: (x: { estado: string; detalle?: string }) => x.estado === 'incidencia' && (x.detalle ?? 'otro').split(' ')[0] === t })),
    ...(d.modoAgresivo ? [{ clave: 'sin_ruta', etiqueta: 'Sin ruta (modo agresivo)', ok: (x: { estado: string }) => x.estado === 'sin_ruta' } as Motivo] : []),
  ]
  const diasDe = (rs3: ResultadoLinea[], m: Motivo) => rs3.reduce((s, r) => s + r.dias.filter(m.ok).length, 0)
  const montoDe = (rs3: ResultadoLinea[], m: Motivo) => r2(rs3.reduce((s, r) => s + r.dias.filter(m.ok).length * r.linea.tarifa, 0))

  // Tabla 1: por plaza (una columna por motivo, en días)
  pp.getCell('A5').value = 'Por plaza — días a reclamar por motivo'
  pp.getCell('A5').font = { name: 'Arial', size: 11, bold: true, color: { argb: NAVY } }
  const colsPl = ['Plaza', 'Conceptos', 'Placas', 'Subtotal facturado', ...motivos.map(m => m.etiqueta + ' (días)'), 'Días a reclamar', 'Reclamo sin IVA', 'Reclamo con IVA', 'Por justificar (sin IVA)']
  encabezado(pp, 6, colsPl)
  const plazas = [...new Set(d.res.map(plazaDe))].sort()
  const filaPlaza = (nombre: string, rs3: ResultadoLinea[]) => [
    nombre, rs3.length, new Set(rs3.map(r => r.linea.placa)).size, r2(rs3.reduce((s, r) => s + r.linea.subtotal, 0)),
    ...motivos.map(m => diasDe(rs3, m)),
    rs3.reduce((s, r) => s + r.diasDescuento, 0), r2(rs3.reduce((s, r) => s + r.montoDescuento, 0)), r2(rs3.reduce((s, r) => s + r.montoDescuento * 1.16, 0)), r2(rs3.reduce((s, r) => s + r.montoPorJustificar, 0)),
  ]
  const fmtPl: Fmt[] = [undefined, '0', '0', MONEDA, ...motivos.map(() => '0'), '0', MONEDA, MONEDA, MONEDA]
  const datosPl = plazas.map(pz => filaPlaza(pz, d.res.filter(r => plazaDe(r) === pz)))
  filas(pp, 7, datosPl, fmtPl)
  const totPl = filaPlaza('TOTAL', d.res); totPl[2] = new Set(lineas.map(l => l.placa)).size
  totalFila(pp, 7 + datosPl.length, totPl, fmtPl)

  // Tabla 2: por motivo (días, placas, importe)
  let g = 7 + datosPl.length + 3
  pp.getCell(g - 1, 1).value = 'Por motivo — desglose del reclamo'
  pp.getCell(g - 1, 1).font = { name: 'Arial', size: 11, bold: true, color: { argb: NAVY } }
  encabezado(pp, g, ['Motivo', 'Días', 'Placas afectadas', 'Importe sin IVA', 'Importe con IVA', 'Placas (días)'])
  const datosMo = motivos.map(m => {
    const afect = d.res.filter(r => r.dias.some(m.ok))
    const porPlaca = new Map<string, number>()
    for (const r of afect) porPlaca.set(r.linea.placa, (porPlaca.get(r.linea.placa) ?? 0) + r.dias.filter(m.ok).length)
    const lista = [...porPlaca.entries()].map(([p, n]) => `${p} (${n})`)
    const monto = montoDe(d.res, m)
    return [m.etiqueta, diasDe(d.res, m), porPlaca.size, monto, r2(monto * 1.16), lista.length > 12 ? `${lista.slice(0, 12).join(', ')} y ${lista.length - 12} más` : lista.join(', ')]
  })
  const fmtMo: Fmt[] = [undefined, '0', '0', MONEDA, MONEDA, undefined]
  filas(pp, g + 1, datosMo, fmtMo)
  totalFila(pp, g + 1 + datosMo.length, ['TOTAL', datosMo.reduce((s, r) => s + Number(r[1]), 0), '', r2(datosMo.reduce((s, r) => s + Number(r[3]), 0)), r2(datosMo.reduce((s, r) => s + Number(r[4]), 0)), ''], fmtMo)
  g = g + 3 + datosMo.length
  // Nota: sin ruta por justificar (no se reclama)
  if (!d.modoAgresivo) {
    const dj = totCnt('sin_ruta'), mj = r2(d.res.reduce((s, r) => s + r.montoPorJustificar, 0))
    pp.getCell(g, 1).value = `Aparte, ${dj} día(s) sin ruta y sin incidencia quedan por justificar (${mj.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} sin IVA). No se incluyen en el reclamo.`
    pp.getCell(g, 1).font = { name: 'Arial', size: 10, italic: true, color: { argb: GRIS } }
  }
  anchos(pp, [30, 12, 14, 18, ...motivos.map(() => 20), 14, 16, 16, 18])
  pp.getColumn(6).width = 40
  pp.views = [{ showGridLines: false, state: 'frozen', xSplit: 1 }]

  // ============ 2. DETALLE RENTAS ============
  const dr = wb.addWorksheet('Detalle rentas', { properties: { tabColor: { argb: 'FF4472C4' } } })
  titulo(dr, 'Detalle consolidado de rentas', 'Cada renglón es un concepto facturado; las columnas de la derecha son el resultado de la conciliación. Ámbar = concepto con días a reclamar.', 22)
  const colsDet = ['Factura', 'Línea', 'Fecha factura', 'Plaza', 'Vehículo facturado', 'Tipo unidad', 'Placas', 'No. de serie', 'Inicio periodo / entrega', 'Fin periodo', 'Días', 'Tarifa', 'Subtotal',
    'Días operó', 'Días incidencia', 'Días duplicado', 'Días antes entrega', 'Días sin ruta', 'Días a reclamar', 'Reclamo sin IVA', 'Por justificar sin IVA', ...(hayCap ? ['Sin ejecutar según capacidad'] : []), 'Observaciones']
  encabezado(dr, 4, colsDet)
  const datosDet = d.res.map(r => {
    const l = r.linea
    return [l.factura_folio, l.linea, fecha(l.factura_fecha), l.plaza, l.vehiculo, uni.get(l.placa)?.tipo ?? '', l.placa, l.serie, fecha(l.inicio), fecha(l.fin), l.dias, l.tarifa, l.subtotal,
      r.conteo.opero, r.conteo.incidencia, r.conteo.duplicado, r.conteo.antes_entrega, r.conteo.sin_ruta, r.diasDescuento, r.montoDescuento, r.montoPorJustificar, ...(hayCap ? [capPorPlaca.get(l.placa)?.length ?? 0] : []), r.banderas.join(' | ')]
  })
  const fmtDet: Fmt[] = [undefined, '0', FECHA, undefined, undefined, undefined, undefined, undefined, FECHA, FECHA, '0', MONEDA, MONEDA, '0', '0', '0', '0', '0', '0', MONEDA, MONEDA, ...(hayCap ? ['0'] : []), undefined]
  filas(dr, 5, datosDet, fmtDet, i => (d.res[i].diasDescuento > 0 ? AMBAR : i % 2 === 0 ? AZUL : BLANCO))
  totalFila(dr, 5 + datosDet.length, ['TOTAL', null, null, null, null, null, null, null, null, null,
    r2(d.res.reduce((s, r) => s + r.linea.dias, 0)), null, r2(d.res.reduce((s, r) => s + r.linea.subtotal, 0)),
    totCnt('opero'), totCnt('incidencia'), totCnt('duplicado'), totCnt('antes_entrega'), totCnt('sin_ruta'),
    d.res.reduce((s, r) => s + r.diasDescuento, 0), r2(d.res.reduce((s, r) => s + r.montoDescuento, 0)), r2(d.res.reduce((s, r) => s + r.montoPorJustificar, 0)), ...(hayCap ? [null] : []), ''], fmtDet)
  anchos(dr, [13, 7, 13, 16, 20, 11, 11, 22, 15, 13, 7, 12, 13, 9, 11, 11, 12, 10, 11, 14, 15, ...(hayCap ? [16] : []), 70])
  dr.views = [{ showGridLines: false, state: 'frozen', xSplit: 7, ySplit: 4 }]
  dr.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + datosDet.length, column: colsDet.length } }

  // ============ 3. INICIO POR PLACAS ============
  const ip = wb.addWorksheet('Inicio por placas', { properties: { tabColor: { argb: 'FF70AD47' } } })
  titulo(ip, 'Inicio observado por placas', 'La fecha corresponde al primer periodo encontrado en las facturas. "Inicio explícito" sólo se marca cuando la factura lo declara textualmente.', 13)
  encabezado(ip, 5, ['Placas', 'Tipo unidad', 'Vehículo', 'No. de serie', 'Primera fecha observada', 'Factura inicial observada', 'Inicio explícito', 'Conceptos', 'Facturas donde aparece',
    'Entrega según inventario', 'Incidencias registradas', 'Días a reclamar', 'Reclamo sin IVA', ...(hayCap ? ['Sin ejecutar según capacidad'] : [])])
  const porPlaca = new Map<string, ResultadoLinea[]>()
  for (const r of d.res) (porPlaca.get(r.linea.placa) ?? porPlaca.set(r.linea.placa, []).get(r.linea.placa)!).push(r)
  const datosIp = [...porPlaca.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([placa, rs2]) => {
    const primera = [...rs2].sort((a, b) => a.linea.inicio.localeCompare(b.linea.inicio) || (a.linea.factura_fecha ?? '').localeCompare(b.linea.factura_fecha ?? ''))[0].linea
    const u = uni.get(placa)
    return [placa, u?.tipo ?? '', primera.vehiculo, primera.serie, fecha(primera.inicio), primera.factura_folio, rs2.some(x => x.linea.inicio_explicito) ? 'Sí' : 'No', rs2.length,
      [...new Set(rs2.map(x => x.linea.factura_folio))].join(', '), fecha(u?.fecha_entrega), d.incidencias.filter(i => i.placa === placa).length,
      rs2.reduce((s, x) => s + x.diasDescuento, 0), r2(rs2.reduce((s, x) => s + x.montoDescuento, 0)), ...(hayCap ? [capPorPlaca.get(placa)?.length ?? 0] : [])]
  })
  const fmtIp: Fmt[] = [undefined, undefined, undefined, undefined, FECHA, undefined, undefined, '0', undefined, FECHA, '0', '0', MONEDA, ...(hayCap ? ['0'] : [])]
  filas(ip, 6, datosIp, fmtIp, i => (Number(datosIp[i][11]) > 0 ? AMBAR : i % 2 === 0 ? AZUL : BLANCO))
  anchos(ip, [12, 12, 20, 24, 16, 16, 12, 11, 26, 16, 13, 12, 15, ...(hayCap ? [16] : [])])
  ip.views = [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 5 }]
  ip.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + datosIp.length, column: hayCap ? 14 : 13 } }

  // ============ 4. RECLAMO AL ARRENDADOR ============
  const rc = wb.addWorksheet('Reclamo al arrendador', { properties: { tabColor: { argb: 'FFC00000' } } })
  titulo(rc, 'Reclamo al arrendador', `Días facturados que no proceden · ${proveedor} · ${periodo}`, 9)
  encabezado(rc, 5, ['Factura', 'Placas', 'Plaza', 'Días a descontar', 'Fechas', 'Motivo', 'Tarifa diaria', 'Importe sin IVA', 'Importe con IVA'])
  const datosRc = d.res.filter(r => r.diasDescuento > 0).flatMap(r => {
    const grupos = new Map<string, string[]>()
    for (const x of r.dias.filter(x => d.modoAgresivo ? ['duplicado', 'antes_entrega', 'incidencia', 'sin_ruta'].includes(x.estado) : ['duplicado', 'antes_entrega', 'incidencia'].includes(x.estado))) {
      const tipo = x.estado === 'incidencia' ? TIPOS_INCIDENCIA.find(t => t.v === x.detalle?.split(' ')[0])?.l ?? x.detalle : x.detalle
      const k = ESTADO_TXT[x.estado] + (tipo ? ` (${String(tipo).replace(' (¡pero hay ruta ese día!)', '')})` : '')
      ;(grupos.get(k) ?? grupos.set(k, []).get(k)!).push(x.fecha)
    }
    return [...grupos.entries()].map(([motivo, fs]) => [r.linea.factura_folio, r.linea.placa, r.linea.plaza, fs.length,
      fs.length > 3 ? `${dmy(fs[0])} … ${dmy(fs[fs.length - 1])}` : fs.map(dmy).join(', '), motivo, r.linea.tarifa, r2(fs.length * r.linea.tarifa), r2(fs.length * r.linea.tarifa * 1.16)])
  })
  const fmtRc: Fmt[] = [undefined, undefined, undefined, '0', undefined, undefined, MONEDA, MONEDA, MONEDA]
  filas(rc, 6, datosRc, fmtRc)
  totalFila(rc, 6 + datosRc.length, ['TOTAL', null, null, datosRc.reduce((s, r) => s + Number(r[3]), 0), '', '', null, r2(datosRc.reduce((s, r) => s + Number(r[7]), 0)), r2(datosRc.reduce((s, r) => s + Number(r[8]), 0))], fmtRc)
  if (!datosRc.length) rc.getCell('A6').value = 'Sin días a reclamar con los datos actuales.'
  anchos(rc, [13, 12, 16, 12, 34, 46, 13, 15, 15])
  rc.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]

  // ============ 5. INCIDENCIAS ============
  const ic = wb.addWorksheet('Incidencias', { properties: { tabColor: { argb: 'FFED7D31' } } })
  titulo(ic, 'Incidencias registradas por los dispatchers', 'Evidencia de los días en que la unidad no operó (taller, falla, llantas…).', 8)
  encabezado(ic, 5, ['Placas', 'Plaza', 'Tipo', 'Desde', 'Hasta', 'Descuenta renta', 'Notas', 'Registrada'])
  const incs = [...d.incidencias].sort((a, b) => a.placa.localeCompare(b.placa) || a.fecha_inicio.localeCompare(b.fecha_inicio))
  filas(ic, 6, incs.map(i => [i.placa, i.plaza, TIPOS_INCIDENCIA.find(t => t.v === i.tipo)?.l ?? i.tipo, fecha(i.fecha_inicio), i.fecha_fin ? fecha(i.fecha_fin) : 'Abierta', i.descuenta ? 'Sí' : 'No', i.notas ?? '', fecha(i.creado_en?.slice(0, 10))]),
    [undefined, undefined, undefined, FECHA, FECHA, undefined, undefined, FECHA])
  if (!incs.length) ic.getCell('A6').value = 'Aún no hay incidencias registradas.'
  anchos(ic, [12, 16, 34, 13, 13, 15, 40, 13])
  ic.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]

  // ============ 6. DETALLE POR DÍA ============
  const dd = wb.addWorksheet('Detalle por día', { properties: { tabColor: { argb: 'FF7F7F7F' } } })
  titulo(dd, 'Detalle por día', 'Estado de cada día facturado, placa por placa.', 5)
  encabezado(dd, 5, ['Factura', 'Placas', 'Fecha', 'Estado', 'Detalle'])
  const colorEstado: Record<string, string> = { duplicado: AMBAR, antes_entrega: AMBAR, incidencia: AMBAR, sin_ruta: DURAZNO }
  const diasFlat = d.res.flatMap(r => r.dias.map(x => ({ r, x })))
  filas(dd, 6, diasFlat.map(({ r, x }) => [r.linea.factura_folio, r.linea.placa, fecha(x.fecha), ESTADO_TXT[x.estado], x.detalle ?? '']), [undefined, undefined, FECHA, undefined, undefined],
    i => colorEstado[diasFlat[i].x.estado] ?? (i % 2 === 0 ? AZUL : BLANCO))
  anchos(dd, [13, 12, 13, 26, 46])
  dd.views = [{ showGridLines: false, state: 'frozen', ySplit: 5 }]
  dd.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + diasFlat.length, column: 5 } }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function descargarBlob(blob: Blob, nombre: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
export type { FacturaLinea }
