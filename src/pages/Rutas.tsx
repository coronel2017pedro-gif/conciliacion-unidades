import { useEffect, useState } from 'react'
import { insertarEnLotes, supabase } from '../supabase'
import { leerLibro, parseCapacidad, parsePrefacturasML, parseRutas } from '../lib/parseExcel'
import type { Capacidad, PrefacturaML, Ruta } from '../lib/types'

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

function PrefacturasCard() {
  const [prev, setPrev] = useState<PrefacturaML[] | null>(null)
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const leer = async (file: File) => { try { setMsg(null); setPrev(parsePrefacturasML(await file.text())) } catch (e: any) { setPrev(null); setMsg({ t: e.message }) } }
  const guardar = async () => {
    if (!prev) return
    setBusy(true)
    try {
      await insertarEnLotes('prefacturas_ml', prev, { onConflict: 'id_prefactura' }, 500)
      await supabase.rpc('log_evento', { p_accion: 'carga_prefacturas_ml', p_entidad: 'prefacturas_ml', p_detalle: { prefacturas: prev.length } })
      setMsg({ t: `${prev.length} prefacturas guardadas (las ya existentes se actualizan: cambian de estado).`, ok: true }); setPrev(null)
    } catch (e: any) { setMsg({ t: e.message.includes('prefacturas_ml') ? 'Falta crear la tabla: ejecuta supabase/migracion_prefacturas_ml.sql en el SQL Editor.' : e.message }) }
    setBusy(false)
  }
  return (
    <div className="card">
      <h2>Prefacturas de pago de Mercado Libre</h2>
      <p className="mut">Sube el CSV «Prefacturas» de Mercado Libre (puedes subir varios, uno por vez). Es el ingreso que paga ML por quincena; se compara contra la renta que factura el arrendador. Se puede volver a subir para actualizar estados.</p>
      <input type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && leer(e.target.files[0])} />
      {prev && <div className="alert okk">Se leyeron <b>{prev.length}</b> prefacturas, periodos {[...new Set(prev.map(p => p.periodo))].sort().join(', ')}; suman <b>{fmt(prev.reduce((s, p) => s + p.total, 0))}</b> sin IVA. <button className="btn" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button></div>}
      {msg && <div className={`alert ${msg.ok ? 'okk' : 'err'}`}>{msg.t}</div>}
    </div>
  )
}

function CapacidadCard() {
  const [prev, setPrev] = useState<Capacidad[] | null>(null)
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const leer = async (file: File) => { try { setMsg(null); setPrev(parseCapacidad(leerLibro(await file.arrayBuffer()))) } catch (e: any) { setPrev(null); setMsg({ t: e.message }) } }
  const noEj = prev?.filter(c => !c.ejecutado).length ?? 0
  const guardar = async () => {
    if (!prev) return
    setBusy(true)
    try {
      await insertarEnLotes('capacidad', prev, { onConflict: 'placa,actualizado', ignoreDuplicates: true }, 500)
      await supabase.rpc('log_evento', { p_accion: 'carga_capacidad', p_entidad: 'capacidad', p_detalle: { registros: prev.length, no_ejecutados: noEj } })
      setMsg({ t: `${prev.length} registros procesados (los ya existentes se omiten).`, ok: true }); setPrev(null)
    } catch (e: any) { setMsg({ t: e.message.includes('capacidad') ? 'Falta crear la tabla capacidad: ejecuta supabase/migracion_capacidad.sql en el SQL Editor.' : e.message }) }
    setBusy(false)
  }
  return (
    <div className="card">
      <h2>Reporte de capacidad (opcional)</h2>
      <p className="mut">Sube el reporte de capacidad de Mercado Libre. Es solo informativo: muestra unidades solicitadas o asignadas que no salieron a ruta. No cambia los montos del reclamo.</p>
      <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files?.[0] && leer(e.target.files[0])} />
      {prev && <div className="alert okk">Se leyeron <b>{prev.length}</b> registros de <b>{new Set(prev.map(c => c.placa)).size}</b> placas; <b>{noEj}</b> sin ejecutar. <button className="btn" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button></div>}
      {msg && <div className={`alert ${msg.ok ? 'okk' : 'err'}`}>{msg.t}</div>}
    </div>
  )
}

export default function Rutas() {
  const [prev, setPrev] = useState<Ruta[] | null>(null)
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const [cob, setCob] = useState<{ min: string; max: string; n: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const cobertura = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('rutas').select('fecha').order('fecha').limit(1),
      supabase.from('rutas').select('fecha').order('fecha', { ascending: false }).limit(1),
      supabase.from('rutas').select('*', { count: 'exact', head: true }),
    ])
    setCob(a.data?.[0] ? { min: a.data[0].fecha, max: b.data![0].fecha, n: c.count ?? 0 } : null)
  }
  useEffect(() => { cobertura() }, [])

  const leer = async (file: File) => {
    try { setMsg(null); setPrev(parseRutas(leerLibro(await file.arrayBuffer()))) } catch (e: any) { setPrev(null); setMsg({ t: e.message }) }
  }
  const fechas = prev?.map(r => r.fecha).sort()
  const placas = prev ? new Set(prev.map(r => r.placa)).size : 0
  const guardar = async () => {
    if (!prev) return
    setBusy(true)
    try {
      await insertarEnLotes('rutas', prev, { onConflict: 'fecha,placa,id_ruta', ignoreDuplicates: true }, 1000)
      await supabase.rpc('log_evento', { p_accion: 'carga_rutas', p_entidad: 'rutas', p_referencia: `${fechas![0]} a ${fechas![fechas!.length - 1]}`, p_detalle: { rutas: prev.length, placas } })
      setMsg({ t: `${prev.length} rutas procesadas (las que ya existían se omiten).`, ok: true }); setPrev(null); cobertura()
    } catch (e: any) { setMsg({ t: e.message }) }
    setBusy(false)
  }
  return (
    <>
    <div className="card">
      <h2>Rutas de Mercado Libre</h2>
      <p className="mut">Sube el reporte de rutas del periodo (el «report_carrier» de Mercado Libre, o el Detalle rutas). Se puede cargar por quincena; no se duplican.</p>
      {cob && <p>Cargadas: <b>{cob.n}</b> rutas del <b>{cob.min}</b> al <b>{cob.max}</b>.</p>}
      <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files?.[0] && leer(e.target.files[0])} />
      {prev && <div className="alert okk">Se leyeron <b>{prev.length}</b> rutas de <b>{placas}</b> placas, del {fechas![0]} al {fechas![fechas!.length - 1]}. <button className="btn" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button></div>}
      {msg && <div className={`alert ${msg.ok ? 'okk' : 'err'}`}>{msg.t}</div>}
    </div>
    <PrefacturasCard />
    <CapacidadCard />
    </>
  )
}
