import { useEffect, useMemo, useState } from 'react'
import { fetchAll, insertarEnLotes, supabase } from '../supabase'
import { leerLibro, parseInventario } from '../lib/parseExcel'
import type { Movimiento, Profile, Unidad } from '../lib/types'

const DIAS_RECIENTE = 15
const hace = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
}

/** Semáforo de un movimiento según quién lo ve: rojo = sale de mi plaza, verde = llega/alta en mi plaza, ámbar = vista general de conciliación. */
function semaforo(m: Movimiento, plaza: string | null, admin: boolean) {
  if (admin) {
    if (m.tipo === 'alta') return { c: 'ok', t: `Alta nueva en ${m.plaza_destino}` }
    if (m.tipo === 'reactivacion') return { c: 'ok', t: `Reactivada en ${m.plaza_destino}` }
    return { c: 'warn', t: `Cambio de plaza: ${m.plaza_origen} → ${m.plaza_destino}` }
  }
  if (m.tipo === 'cambio_plaza' && m.plaza_origen === plaza) return { c: 'bad', t: `BAJA en tu plaza: se fue a ${m.plaza_destino}` }
  if (m.tipo === 'cambio_plaza') return { c: 'ok', t: `ALTA en tu plaza: llegó de ${m.plaza_origen}` }
  if (m.tipo === 'reactivacion') return { c: 'ok', t: 'Unidad reactivada en tu plaza' }
  return { c: 'ok', t: 'ALTA nueva en tu plaza' }
}

export default function Unidades({ perfil }: { perfil: Profile }) {
  const admin = perfil.rol !== 'dispatcher'
  const [lista, setLista] = useState<Unidad[]>([])
  const [movs, setMovs] = useState<Movimiento[]>([])
  const [msg, setMsg] = useState<{ t: string; ok?: boolean; warn?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const vacio = { placa: '', plaza: '', vehiculo: '', tipo: '', serie: '', operador: '', fecha_entrega: '' }
  const [f, setF] = useState(vacio)

  const cargar = () => {
    fetchAll<Unidad>('unidades', 'placa').then(setLista).catch(e => setMsg({ t: e.message }))
    supabase.from('movimientos_unidades').select('*').order('creado_en', { ascending: false }).limit(200)
      .then(({ data }) => setMovs((data ?? []) as Movimiento[]))
  }
  useEffect(() => { cargar() }, [])

  const plazas = useMemo(() => [...new Set(lista.map(u => u.plaza).filter(Boolean))].sort() as string[], [lista])
  const recientes = movs.filter(m => Date.now() - new Date(m.creado_en).getTime() < 30 * 86400000)
  const ultimoMov = useMemo(() => {
    const mp = new Map<string, Movimiento>()
    for (const m of movs) if (!mp.has(m.placa) && Date.now() - new Date(m.creado_en).getTime() < DIAS_RECIENTE * 86400000) mp.set(m.placa, m)
    return mp
  }, [movs])

  const importar = async (file: File) => {
    try {
      const u = parseInventario(leerLibro(await file.arrayBuffer()))
      await insertarEnLotes('unidades', u, { onConflict: 'placa' })
      setMsg({ t: `${u.length} unidades importadas/actualizadas.`, ok: true }); cargar()
    } catch (e: any) { setMsg({ t: e.message }) }
  }
  const cambiar = async (placa: string, campo: Partial<Unidad>) => {
    const { error } = await supabase.from('unidades').update(campo).eq('placa', placa)
    if (error) setMsg({ t: error.message }); else cargar()
  }

  const llamar = async (confirmar: boolean) => {
    const { data, error } = await supabase.rpc('registrar_unidad', {
      p_placa: f.placa, p_plaza: admin ? f.plaza : null, p_vehiculo: f.vehiculo || null, p_tipo: f.tipo || null,
      p_serie: f.serie || null, p_operador: f.operador || null, p_fecha_entrega: f.fecha_entrega || null, p_confirmar: confirmar,
    })
    if (error) throw new Error(error.message.includes('registrar_unidad') ? 'Falta ejecutar supabase/migracion_movimientos_unidades.sql en el SQL Editor de Supabase.' : error.message)
    return data as any
  }
  const registrar = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      let r = await llamar(false)
      if (r.estado === 'requiere_confirmacion') {
        const ok = confirm(`La placa ${r.placa} está registrada en ${r.plaza_actual}.\n\n¿Confirmas que ahora pertenece a ${r.plaza_nueva}?\nSe dará de BAJA en ${r.plaza_actual} y de ALTA en ${r.plaza_nueva}.`)
        if (!ok) { setBusy(false); return }
        r = await llamar(true)
      }
      if (r.estado === 'ya_existe') setMsg({ t: `La unidad ${r.placa} ya está registrada en ${r.plaza}.`, warn: true })
      else {
        setMsg({
          ok: true, t: r.estado === 'cambio_plaza' ? `🔁 ${r.placa}: baja en ${r.origen} y alta en ${r.destino}. Quedó registrado el movimiento.`
            : r.estado === 'reactivada' ? `🟢 ${r.placa} reactivada en ${r.plaza}.` : `🟢 ${r.placa} registrada en ${r.plaza}.`,
        })
        setF(vacio); cargar()
      }
    } catch (e: any) { setMsg({ t: e.message }) }
    setBusy(false)
  }

  return (
    <>
      <form className="card" onSubmit={registrar}>
        <h2>Agregar unidad</h2>
        <p className="mut" style={{ marginTop: 0 }}>
          Registra una unidad nueva{admin ? '' : ` en tu plaza (${perfil.plaza ?? '—'})`}. Si la placa ya existe en otra plaza, el sistema la da de baja allá y de alta {admin ? 'en la plaza que indiques' : 'aquí'}, y deja el movimiento registrado.
        </p>
        <div className="grid">
          <div><label>Placa</label><input value={f.placa} onChange={e => setF({ ...f, placa: e.target.value.toUpperCase() })} required /></div>
          {admin && <div><label>Plaza</label><input list="plazas-u" value={f.plaza} onChange={e => setF({ ...f, plaza: e.target.value.toUpperCase() })} required />
            <datalist id="plazas-u">{plazas.map(p => <option key={p} value={p} />)}</datalist></div>}
          <div><label>Vehículo / marca</label><input value={f.vehiculo} onChange={e => setF({ ...f, vehiculo: e.target.value })} placeholder="Ej. Nissan NV350" /></div>
          <div><label>Tipo</label><input value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} placeholder="Ej. Van" /></div>
          <div><label>Serie (opcional)</label><input value={f.serie} onChange={e => setF({ ...f, serie: e.target.value.toUpperCase() })} /></div>
          <div><label>Operador (opcional)</label><input value={f.operador} onChange={e => setF({ ...f, operador: e.target.value })} /></div>
          <div><label>Fecha de entrega (opcional)</label><input type="date" value={f.fecha_entrega} onChange={e => setF({ ...f, fecha_entrega: e.target.value })} /></div>
          <div><button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Agregar unidad'}</button></div>
        </div>
        {msg && <div className={`alert ${msg.ok ? 'okk' : msg.warn ? '' : 'err'}`}>{msg.t}</div>}
      </form>

      <div className="card">
        <h2>Movimientos recientes ({recientes.length})</h2>
        <p className="mut" style={{ marginTop: 0 }}><span className="sem ok" /> alta / llegada &nbsp; <span className="sem bad" /> baja / salida &nbsp; <span className="sem warn" /> cambio de plaza (vista general) · últimos 30 días</p>
        {recientes.length === 0 ? <p className="mut">Sin movimientos.</p> : (
          <div className="movs">{recientes.map(m => {
            const s = semaforo(m, perfil.plaza, admin)
            return <div key={m.id} className="mov"><span className={`sem ${s.c}`} /><b>{m.placa}</b><span>{s.t}</span><small className="mut">{hace(m.creado_en)}{m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''}</small></div>
          })}</div>
        )}
      </div>

      <div className="card">
        <h2>{admin ? 'Inventario de unidades' : `Mis unidades · ${perfil.plaza ?? ''}`} ({lista.length})</h2>
        {admin && <>
          <p className="mut">Sube el Excel del inventario (columnas: Placa, Localidad, Marca/vehículo, Tipo, Serie, Operador responsable, Fecha entrega). Si la placa ya existe se actualiza.</p>
          <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files?.[0] && importar(e.target.files[0])} />
        </>}
        <div className="scroll"><table className="cards">
          <thead><tr><th>Placa</th><th>Plaza</th><th>Vehículo</th><th>Tipo</th><th>Serie</th><th>Operador</th><th>Entrega</th><th>Activa</th></tr></thead>
          <tbody>{lista.map(u => {
            const m = ultimoMov.get(u.placa)
            const s = m && semaforo(m, perfil.plaza, admin)
            return (
              <tr key={u.placa}><td className="titulo"><b>{u.placa}</b>{s && <span className={`pill ${s.c === 'ok' ? '' : s.c}`} title={s.t}>{m!.tipo === 'cambio_plaza' ? (admin ? `de ${m!.plaza_origen}` : 'llegó') : 'nueva'} · {hace(m!.creado_en)}</span>}</td>
                <td data-label="Plaza">{u.plaza}</td><td data-label="Vehículo">{u.vehiculo}</td><td data-label="Tipo">{u.tipo}</td><td data-label="Serie" className="mut">{u.serie}</td><td data-label="Operador">{u.operador}</td>
                <td data-label="Entrega">{admin ? <input type="date" defaultValue={u.fecha_entrega ?? ''} onBlur={e => e.target.value !== (u.fecha_entrega ?? '') && cambiar(u.placa, { fecha_entrega: e.target.value || null })} /> : u.fecha_entrega}</td>
                <td data-label="Activa">{admin ? <input type="checkbox" style={{ width: 'auto' }} checked={u.activa} onChange={e => cambiar(u.placa, { activa: e.target.checked })} /> : (u.activa ? 'Sí' : 'No')}</td></tr>
            )
          })}</tbody>
        </table></div>
      </div>
    </>
  )
}
