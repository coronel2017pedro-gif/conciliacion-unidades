import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../supabase'
import { DESCUENTA_POR_DEFECTO, TIPOS_INCIDENCIA, type Incidencia, type Profile, type TipoIncidencia, type Unidad } from '../lib/types'

const hoy = () => new Date().toLocaleDateString('en-CA')

export default function Incidencias({ perfil }: { perfil: Profile }) {
  const admin = perfil.rol !== 'dispatcher'
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [lista, setLista] = useState<Incidencia[]>([])
  const [msg, setMsg] = useState('')
  const [plazaF, setPlazaF] = useState('')
  const [f, setF] = useState({ placa: '', tipo: 'taller' as TipoIncidencia, fecha_inicio: hoy(), fecha_fin: '', descuenta: true, plaza_destino: '', notas: '' })

  const cargar = async () => {
    const [u, i] = await Promise.all([fetchAll<Unidad>('unidades', 'placa'), fetchAll<Incidencia>('incidencias', 'fecha_inicio')])
    setUnidades(u); setLista(i.reverse())
  }
  useEffect(() => { cargar().catch(e => setMsg(e.message)) }, [])

  const uni = useMemo(() => new Map(unidades.map(u => [u.placa, u])), [unidades])
  const plazas = useMemo(() => [...new Set(unidades.map(u => u.plaza).filter(Boolean))].sort() as string[], [unidades])
  const guardar = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('')
    const u = uni.get(f.placa)
    if (!u) return setMsg('Elige una unidad')
    if (f.fecha_fin && f.fecha_fin < f.fecha_inicio) return setMsg('La fecha de fin no puede ser anterior al inicio')
    const { error } = await supabase.from('incidencias').insert({
      placa: f.placa, tipo: f.tipo, fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_fin || null, descuenta: f.descuenta,
      plaza: u.plaza, plaza_destino: f.tipo === 'cambio_plaza' ? f.plaza_destino || null : null, notas: f.notas || null,
    })
    if (error) return setMsg(error.message)
    setF({ ...f, placa: '', fecha_fin: '', notas: '' }); cargar()
  }
  const cerrar = async (i: Incidencia) => {
    const { error } = await supabase.from('incidencias').update({ fecha_fin: hoy() }).eq('id', i.id)
    if (error) setMsg(error.message); else cargar()
  }
  const borrar = async (i: Incidencia) => {
    if (!confirm(`¿Borrar la incidencia de ${i.placa}?`)) return
    const { error } = await supabase.from('incidencias').delete().eq('id', i.id)
    if (error) setMsg(error.message); else cargar()
  }
  const visibles = lista.filter(i => !plazaF || i.plaza === plazaF)

  return (
    <>
      <form className="card" onSubmit={guardar}>
        <h2>Registrar incidencia de una unidad</h2>
        <p className="mut" style={{ marginTop: 0 }}>Registra el día en que la unidad deja de trabajar (taller, falla, llantas…). Mientras esté abierta, se cuentan días sin operar; al volver a trabajar, ciérrala.</p>
        <div className="grid">
          <div><label>Unidad (placa)</label>
            <select value={f.placa} onChange={e => setF({ ...f, placa: e.target.value })} required>
              <option value="">— elegir —</option>
              {unidades.filter(u => u.activa).map(u => <option key={u.placa} value={u.placa}>{u.placa} · {u.vehiculo} · {u.plaza}</option>)}
            </select></div>
          <div><label>Tipo</label>
            <select value={f.tipo} onChange={e => { const t = e.target.value as TipoIncidencia; setF({ ...f, tipo: t, descuenta: DESCUENTA_POR_DEFECTO[t] }) }}>
              {TIPOS_INCIDENCIA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select></div>
          <div><label>Desde</label><input type="date" value={f.fecha_inicio} onChange={e => setF({ ...f, fecha_inicio: e.target.value })} required /></div>
          <div><label>Hasta (vacío = sigue abierta)</label><input type="date" value={f.fecha_fin} onChange={e => setF({ ...f, fecha_fin: e.target.value })} /></div>
          {f.tipo === 'cambio_plaza' && <div><label>Plaza destino</label><input value={f.plaza_destino} onChange={e => setF({ ...f, plaza_destino: e.target.value.toUpperCase() })} /></div>}
          <div><label>Notas</label><input value={f.notas} onChange={e => setF({ ...f, notas: e.target.value })} placeholder="Ej. orden de taller #123" /></div>
          {admin && <div><label><input type="checkbox" style={{ width: 'auto' }} checked={f.descuenta} onChange={e => setF({ ...f, descuenta: e.target.checked })} /> Descuenta renta (responsabilidad del arrendador)</label></div>}
          <div><button className="btn">Guardar incidencia</button></div>
        </div>
        {msg && <div className="alert err">{msg}</div>}
      </form>

      <div className="card">
        <div className="row"><h2 style={{ margin: 0 }}>Incidencias ({visibles.length})</h2>
          {admin && <select style={{ width: 'auto' }} value={plazaF} onChange={e => setPlazaF(e.target.value)}><option value="">Todas las plazas</option>{plazas.map(p => <option key={p}>{p}</option>)}</select>}</div>
        <div className="scroll"><table className="cards">
          <thead><tr><th>Placa</th><th>Plaza</th><th>Tipo</th><th>Desde</th><th>Hasta</th>{admin && <th>Descuenta</th>}<th>Notas</th><th></th></tr></thead>
          <tbody>{visibles.map(i => (
            <tr key={i.id}><td className="titulo"><b>{i.placa}</b>{!i.fecha_fin && <span className="pill warn">abierta</span>}</td>
              <td data-label="Plaza">{i.plaza}</td><td data-label="Tipo">{TIPOS_INCIDENCIA.find(t => t.v === i.tipo)?.l}</td>
              <td data-label="Desde">{i.fecha_inicio}</td><td data-label="Hasta">{i.fecha_fin ?? '—'}</td>
              {admin && <td data-label="Descuenta">{i.descuenta ? 'Sí' : 'No'}</td>}<td data-label="Notas">{i.notas}</td>
              <td className="acciones row">{!i.fecha_fin && <button className="link" onClick={() => cerrar(i)}>Ya volvió a operar</button>}
                {admin && <button className="link bad" onClick={() => borrar(i)}>Borrar</button>}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  )
}
