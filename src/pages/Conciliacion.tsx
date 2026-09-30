import { useEffect, useMemo, useState } from 'react'
import { fetchAll, supabase } from '../supabase'
import { conciliar, resumenPorFactura, type ResultadoLinea } from '../lib/reconcile'
import { descargarBlob, generarReporte } from '../lib/exportXlsx'
import type { Capacidad, Factura, FacturaLinea, Incidencia, PrefacturaML, Ruta, Unidad } from '../lib/types'

const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const ETQ: Record<string, string> = { duplicado: 'Duplicado', antes_entrega: 'Antes de entrega', incidencia: 'Incidencia', opero: 'Operó', sin_ruta: 'Sin ruta', sin_datos: 'Sin datos' }

export default function Conciliacion() {
  const [d, setD] = useState<{ lineas: FacturaLinea[]; inc: Incidencia[]; rutas: Ruta[]; uni: Unidad[]; folios: string[]; facturas: Factura[]; cap: Capacidad[]; pref: PrefacturaML[] } | null>(null)
  const [err, setErr] = useState('')
  const [agresivo, setAgresivo] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [abierta, setAbierta] = useState<string | null>(null)
  const [soloObs, setSoloObs] = useState(false)
  const [exportando, setExportando] = useState(false)

  const cargar = async () => {
    try {
      const facts = await fetchAll<Factura & { estatus: string }>('facturas', 'folio')
      const vigentes = facts.filter(f => f.estatus === 'vigente').map(f => f.folio)
      const [lineas, inc, rutas, uni] = await Promise.all([
        fetchAll<FacturaLinea>('factura_lineas', 'factura_folio'), fetchAll<Incidencia>('incidencias', 'fecha_inicio'),
        fetchAll<Ruta>('rutas', 'fecha'), fetchAll<Unidad>('unidades', 'placa'),
      ])
      const cap = await fetchAll<Capacidad>('capacidad', 'actualizado').catch(() => [] as Capacidad[])
      const pref = await fetchAll<PrefacturaML>('prefacturas_ml', 'periodo').catch(() => [] as PrefacturaML[])
      setD({ lineas: lineas.filter(l => vigentes.includes(l.factura_folio)), inc, rutas, uni, folios: vigentes, facturas: facts, cap, pref }); setSel(new Set(vigentes))
    } catch (e: any) { setErr(e.message) }
  }
  useEffect(() => { cargar() }, [])

  const res = useMemo<ResultadoLinea[]>(() => {
    if (!d) return []
    return conciliar(d.lineas.filter(l => sel.has(l.factura_folio)), d.inc, d.rutas, d.uni, { descontarSinRuta: agresivo })
  }, [d, sel, agresivo])
  const resumen = useMemo(() => resumenPorFactura(res), [res])

  if (err) return <div className="alert err">{err}</div>
  if (!d) return <div className="card">Cargando datos…</div>
  const desc = resumen.reduce((s, f) => s + f.descuento, 0), just = resumen.reduce((s, f) => s + f.porJustificar, 0), sub = resumen.reduce((s, f) => s + f.subtotal, 0)
  const filas = res.filter(r => !soloObs || r.banderas.length || r.diasDescuento || r.conteo.sin_ruta)

  return (
    <>
      <div className="card">
        <h2>Conciliación</h2>
        {d.folios.length === 0 && <div className="alert">No hay facturas vigentes. Carga facturas en la pestaña Facturas.</div>}
        {d.rutas.length === 0 && <div className="alert">Aún no hay rutas cargadas: los días no se podrán comparar contra operación.</div>}
        <div className="row">
          <span className="mut">Facturas a conciliar:</span>
          {d.folios.map(f => <label key={f} className="row" style={{ margin: 0, color: 'inherit', fontSize: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(f)} onChange={e => { const n = new Set(sel); e.target.checked ? n.add(f) : n.delete(f); setSel(n) }} />{f}</label>)}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="row" style={{ margin: 0, color: 'inherit', fontSize: 14 }}><input type="checkbox" style={{ width: 'auto' }} checked={agresivo} onChange={e => setAgresivo(e.target.checked)} />Descontar también los días sin ruta y sin justificar</label>
          <label className="row" style={{ margin: 0, color: 'inherit', fontSize: 14 }}><input type="checkbox" style={{ width: 'auto' }} checked={soloObs} onChange={e => setSoloObs(e.target.checked)} />Mostrar solo conceptos con observaciones</label>
          <span className="sp" style={{ flex: 1 }} />
          <button className="btn" disabled={!res.length || exportando} onClick={async () => {
            setExportando(true)
            try {
              const blob = await generarReporte({ res, resumen, facturas: d.facturas, unidades: d.uni, incidencias: d.inc, capacidad: d.cap, prefacturas: d.pref, modoAgresivo: agresivo })
              descargarBlob(blob, `Conciliacion_${new Date().toLocaleDateString('en-CA')}.xlsx`)
              supabase.rpc('log_evento', { p_accion: 'exportar_conciliacion', p_entidad: 'conciliacion', p_referencia: [...sel].join(', '), p_detalle: { descuento: desc, porJustificar: just, modoAgresivo: agresivo } })
            } catch (e: any) { setErr(e.message) }
            setExportando(false)
          }}>{exportando ? 'Generando…' : 'Descargar Excel'}</button>
        </div>
      </div>

      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="kpi"><span className="mut">Facturado (sin IVA)</span><b>{fmt(sub)}</b></div>
        <div className="kpi"><span className="mut">A descontar (sin IVA)</span><b className="bad">{fmt(desc)}</b><small className="mut">{fmt(desc * 1.16)} con IVA</small></div>
        <div className="kpi"><span className="mut">Por justificar (sin IVA)</span><b className="warn">{fmt(just)}</b><small className="mut">días sin ruta y sin incidencia</small></div>
        <div className="kpi"><span className="mut">Conceptos con observaciones</span><b>{res.filter(r => r.banderas.length).length}</b></div>
      </div>

      <div className="card">
        <h2>Por factura</h2>
        <table><thead><tr><th>Factura</th><th className="n">Conceptos</th><th className="n">Subtotal</th><th className="n">Días a descontar</th><th className="n">Descuento</th><th className="n">Por justificar</th></tr></thead>
          <tbody>{resumen.map(f => <tr key={f.folio}><td><b>{f.folio}</b></td><td className="n">{f.lineas}</td><td className="n">{fmt(f.subtotal)}</td><td className="n">{f.diasDescuento}</td><td className="n bad">{fmt(f.descuento)}</td><td className="n warn">{fmt(f.porJustificar)}</td></tr>)}</tbody></table>
      </div>

      <div className="card">
        <h2>Por concepto ({filas.length})</h2>
        <div className="scroll"><table>
          <thead><tr><th>Factura</th><th>Placa</th><th>Plaza</th><th>Periodo</th><th className="n">Fact.</th><th className="n">Operó</th><th className="n">Incid.</th><th className="n">Dup.</th><th className="n">Sin ruta</th><th className="n">Descuento</th><th>Observaciones</th></tr></thead>
          <tbody>{filas.map(r => {
            const k = `${r.linea.factura_folio}-${r.linea.linea}`
            return [
              <tr key={k} onClick={() => setAbierta(abierta === k ? null : k)} style={{ cursor: 'pointer' }}>
                <td>{r.linea.factura_folio}</td><td><b>{r.linea.placa}</b></td><td>{r.linea.plaza}</td><td>{r.linea.inicio.slice(5)} → {r.linea.fin.slice(5)}</td>
                <td className="n">{r.linea.dias}</td><td className="n">{r.conteo.opero}</td><td className="n">{r.conteo.incidencia + r.conteo.antes_entrega}</td><td className="n">{r.conteo.duplicado}</td><td className="n warn">{r.conteo.sin_ruta}</td>
                <td className="n bad">{r.montoDescuento ? fmt(r.montoDescuento) : ''}</td><td className="warn">{r.banderas.join(' · ')}</td></tr>,
              abierta === k && <tr key={k + 'd'}><td colSpan={11}><div className="chips">{r.dias.map(x => <span key={x.fecha} className={`chip ${x.estado}`} title={`${ETQ[x.estado]}${x.detalle ? ' — ' + x.detalle : ''}`}>{x.fecha.slice(8)}·{ETQ[x.estado]}</span>)}</div></td></tr>,
            ]
          })}</tbody>
        </table></div>
      </div>
    </>
  )
}
