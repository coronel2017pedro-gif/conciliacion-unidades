import * as XLSX from 'xlsx'
import { cellToIso, normPlaca } from './dates'
import type { Capacidad, FacturaLinea, PrefacturaML, Ruta, Unidad } from './types'

const key = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '')

/** Busca la fila de encabezados que contiene todas las columnas requeridas y devuelve filas como objetos. */
function tabla(wb: XLSX.WorkBook, requeridas: string[], hoja?: string): Record<string, unknown>[] | null {
  const nombres = hoja && wb.SheetNames.includes(hoja) ? [hoja] : wb.SheetNames
  for (const n of nombres) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: null })
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const hdr = (rows[i] as unknown[]).map(key)
      if (requeridas.every(r => hdr.includes(r))) {
        return rows.slice(i + 1).map(r => {
          const o: Record<string, unknown> = {}
          hdr.forEach((h, c) => { if (h && !(h in o)) o[h] = (r as unknown[])[c] })
          return o
        })
      }
    }
  }
  return null
}

export function leerLibro(buf: ArrayBuffer) { return XLSX.read(buf, { type: 'array', cellDates: true }) }

/** Reporte de rutas de Mercado Libre: Fecha, Placa, ID ruta, ... */
export function parseRutas(wb: XLSX.WorkBook): Ruta[] {
  // Acepta el "Detalle rutas" ya armado o el reporte crudo de Mercado Libre (report_carrier: hoja "Métricas")
  const t = tabla(wb, ['fecha', 'placa', 'idruta'], 'Detalle rutas') ?? tabla(wb, ['fecha', 'placa', 'iddelaruta'], 'Métricas')
  if (!t) throw new Error('No encontré columnas Fecha / Placa / ID de ruta en el archivo de rutas.')
  const out: Ruta[] = []
  for (const r of t) {
    const fecha = cellToIso(r.fecha), placa = normPlaca(String(r.placa ?? '').replace(/^\s*SDD\s*-\s*/i, ''))
    if (!fecha || !placa) continue
    const desp = r.despachados ?? r.enviosdespachados, entr = r.entregados ?? r.enviosentregados
    out.push({
      fecha, placa, id_ruta: String(r.idruta ?? r.iddelaruta ?? ''), transportista: ((r.transportista ?? r.nombredeltransportista) as string) ?? null,
      despachados: desp == null ? null : Number(desp), entregados: entr == null ? null : Number(entr),
    })
  }
  return out
}

/** Inventario de unidades: Placa, Localidad/Plaza, Marca/Vehículo, Tipo, Serie, Operador, Fecha entrega */
export function parseInventario(wb: XLSX.WorkBook): Unidad[] {
  const t = tabla(wb, ['placa'], 'Inventario PDF') ?? tabla(wb, ['placa'])
  if (!t) throw new Error('No encontré la columna Placa en el inventario.')
  const pick = (r: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) if (r[k] != null && r[k] !== '') return String(r[k]).trim(); return null }
  return t.filter(r => normPlaca(r.placa)).map(r => ({
    placa: normPlaca(r.placa), plaza: pick(r, 'localidad', 'plaza')?.toUpperCase() ?? null,
    vehiculo: pick(r, 'marcavehiculo', 'vehiculo'), tipo: pick(r, 'tipo'), serie: pick(r, 'serie', 'noserie'),
    operador: pick(r, 'operadorresponsable', 'operador'), fecha_entrega: cellToIso(r.fechaentrega), activa: true,
  }))
}

/** Desglose de facturas ya hecho (hoja "Detalle rentas"): alternativa a subir los PDF. */
export function parseDesgloseFacturas(wb: XLSX.WorkBook): FacturaLinea[] {
  const t = tabla(wb, ['factura', 'placas', 'iniciodeperiodoentrega'].slice(0, 2), 'Detalle rentas')
  if (!t) throw new Error('No encontré la hoja "Detalle rentas" con columnas Factura / Placas.')
  return t.filter(r => r.factura && normPlaca(r.placas)).map(r => ({
    factura_folio: String(r.factura), factura_fecha: cellToIso(r.fechafactura), linea: Number(r.linea) || 0,
    placa: normPlaca(r.placas), serie: (r.nodeserie as string) ?? null, vehiculo: (r.vehiculofacturado as string) ?? null,
    plaza: (r.plaza as string) ?? null, inicio: cellToIso(r.iniciodeperiodoentrega ?? r.inicioperiodoentrega)!, fin: cellToIso(r.finperiodo)!,
    dias: Number(r.dias) || 0, tarifa: Number(r.tarifadiaria) || 0, subtotal: Number(r.subtotal) || 0,
    inicio_explicito: String(r.inicioexplicito ?? '').toLowerCase().startsWith('s'),
  })).filter(l => l.inicio && l.fin)
}

/** Reporte de capacidad de Mercado Libre (hoja "Gestion capacidad"): placa, si se solicitó/confirmó/asignó y si se ejecutó. */
export function parseCapacidad(wb: XLSX.WorkBook): Capacidad[] {
  const t = tabla(wb, ['placa', 'ultimaactualizacion', 'ejecutado'], 'Gestion capacidad')
  if (!t) throw new Error('No encontré las columnas Placa / Última actualización / Ejecutado del reporte de capacidad.')
  const marca = (v: unknown) => String(v ?? '').trim() !== ''
  const out = new Map<string, Capacidad>()
  for (const r of t) {
    const placa = normPlaca(String(r.placa ?? '').replace(/^\s*SDD\s*-\s*/i, ''))
    const act = r.ultimaactualizacion instanceof Date ? r.ultimaactualizacion.toISOString().slice(0, 19) : String(r.ultimaactualizacion ?? '').slice(0, 19)
    if (!placa || !act) continue
    const idr = String(r.iddelaruta ?? '')
    out.set(`${placa}|${act}`, {
      placa, actualizado: act, service_center: (r.servicecenter as string) ?? null, vehiculo: (r.vehiculo as string) ?? null,
      transportista: (r.nombredeltransportista as string) ?? null, id_ruta: idr && idr !== 'NULL' ? idr : null,
      solicitado: marca(r.solicitado), confirmado: marca(r.confirmado), asignado: marca(r.asignado), escaneado: marca(r.escaneado), ejecutado: marca(r.ejecutado),
    })
  }
  return [...out.values()]
}

/** CSV «Prefacturas» de Mercado Libre (separado por «;», fechas dd/mm/aaaa, importes con punto decimal). */
export function parsePrefacturasML(texto: string): PrefacturaML[] {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  if (lineas.length < 2) throw new Error('El archivo de prefacturas está vacío.')
  const sep = lineas[0].includes(';') ? ';' : ','
  const hdr = lineas[0].split(sep).map(key)
  const ix = (k: string) => hdr.indexOf(k)
  const need = ['idprefactura', 'tipodeprefactura', 'periodo', 'totalprefactura']
  if (need.some(k => ix(k) < 0)) throw new Error('No parece el CSV de Prefacturas de Mercado Libre (faltan ID prefactura / Periodo / Total prefactura).')
  const dmy = (s: string) => { const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
  const num = (s: string) => { if (s == null || s.trim() === '') return null; const n = Number(s.replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null }
  const out: PrefacturaML[] = []
  for (const l of lineas.slice(1)) {
    const c = l.split(sep).map(x => x.trim()), g = (k: string) => c[ix(k)] ?? ''
    const total = num(g('totalprefactura'))
    if (!g('idprefactura') || total == null) continue
    out.push({
      id_prefactura: g('idprefactura'), tipo: g('tipodeprefactura'), subtipo: g('subtipodeprefactura') || null, periodo: g('periodo'), total,
      estado: g('estadoprefactura') || null, ultima_modificacion: dmy(g('ultimamodificacion')), nro_comprobante: g('nrocomprobante') || null,
      fecha_carga: dmy(g('fechadecarga')), subtotal: num(g('subtotal')), total_con_iva: num(g('total')), id_sap: g('idsap') || null,
    })
  }
  if (!out.length) throw new Error('No encontré prefacturas en el archivo.')
  return out
}
