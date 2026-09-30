import { useEffect, useMemo, useState } from 'react'
import { fetchAll, supabase } from '../supabase'
import type { Profile, Rol, Unidad } from '../lib/types'

const PLAZAS_BASE = ['IRAPUATO', 'CELAYA', 'MORELIA', 'ZACATECAS', 'AGUASCALIENTES', 'ZAMORA', 'LEÓN', 'SALAMANCA']

/** Nombre (slug) con el que está publicada la función en Supabase: es lo que aparece al final de su URL .../functions/v1/<slug> */
const FUNCION = 'supabase-functions-admin-usuarios-index-ts'

/** Alta y cambio de contraseña (requieren la Edge Function porque tocan Supabase Auth). */
async function admin(body: object): Promise<any> {
  const { data, error } = await supabase.functions.invoke(FUNCION, { body })
  if (error) {
    let detalle = error.message
    try { const r = (error as any).context; if (r?.json) { const j = await r.json(); if (j?.error) detalle = j.error } } catch { /* sin cuerpo */ }
    throw new Error(`No se pudo completar (${detalle}). Revisa que la función esté publicada con el nombre «${FUNCION}».`)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
/** Activar/desactivar, plaza y nombre: directo en la base de datos (no dependen de la función). */
async function rpc(fn: string, args: object): Promise<void> {
  const { error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
}

export default function Usuarios({ perfil }: { perfil: Profile }) {
  const esMaster = perfil.rol === 'master'
  const [lista, setLista] = useState<Profile[]>([])
  const [plazas, setPlazas] = useState<string[]>(PLAZAS_BASE)
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'dispatcher' as Rol, plaza: '' })

  const cargar = async () => {
    const [p, u] = await Promise.all([fetchAll<Profile>('profiles', 'nombre'), fetchAll<Unidad>('unidades', 'placa')])
    setLista(p)
    setPlazas([...new Set([...PLAZAS_BASE, ...u.map(x => x.plaza).filter(Boolean) as string[]])].sort())
  }
  useEffect(() => { cargar().catch(e => setMsg({ t: e.message })) }, [])

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ t: ok, ok: true }); await cargar() } catch (e: any) { setMsg({ t: e.message }) }
    setBusy(false)
  }
  const crear = (e: React.FormEvent) => {
    e.preventDefault()
    run(async () => {
      const r = await admin({ accion: 'crear', ...f })
      const { data: chk } = await supabase.from('profiles').select('id').eq('id', r?.id).maybeSingle()
      if (r?.version !== 2) throw new Error('En Supabase está publicada una versión vieja de la función admin-usuarios. Pega el código nuevo (archivo index.ts) y dale Deploy.')
      if (!r?.id || !chk) throw new Error('La función respondió pero el usuario no quedó guardado. Revisa Edge Functions → admin-usuarios → Logs.')
      setF({ ...f, nombre: '', email: '', password: '' })
    }, `Usuario ${f.email} creado y guardado. Ya puede entrar con esa contraseña.`)
  }
  const visibles = useMemo(() => lista.filter(u => esMaster || u.rol === 'dispatcher'), [lista, esMaster])

  return (
    <>
      <form className="card" onSubmit={crear}>
        <h2>Alta de usuario</h2>
        <div className="grid">
          <div><label>Nombre</label><input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} required /></div>
          <div><label>Correo (será su usuario)</label><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required /></div>
          <div><label>Contraseña (mín. 6)</label><input type="text" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} minLength={6} required /></div>
          <div><label>Rol</label>
            <select value={f.rol} onChange={e => setF({ ...f, rol: e.target.value as Rol })}>
              <option value="dispatcher">Dispatcher</option>
              {esMaster && <option value="conciliacion">Conciliación / nómina</option>}
              {esMaster && <option value="master">Master (sistemas)</option>}
            </select></div>
          {f.rol === 'dispatcher' && <div><label>Plaza</label>
            <input list="plazas" value={f.plaza} onChange={e => setF({ ...f, plaza: e.target.value.toUpperCase() })} required />
            <datalist id="plazas">{plazas.map(p => <option key={p} value={p} />)}</datalist></div>}
          <div><button className="btn" disabled={busy}>Crear usuario</button></div>
        </div>
        <p className="mut" style={{ marginBottom: 0 }}>La plaza debe escribirse igual que en el inventario de unidades; con eso el dispatcher solo ve las unidades de su plaza.</p>
        {msg && <div className={`alert ${msg.ok ? 'okk' : 'err'}`}>{msg.t}</div>}
      </form>

      <div className="card">
        <h2>Usuarios ({visibles.length})</h2>
        <div className="scroll"><table className="cards">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Plaza</th><th>Estado</th><th></th></tr></thead>
          <tbody>{visibles.map(u => (
            <tr key={u.id}><td className="titulo"><button className="link" disabled={busy} onClick={() => { const n = prompt('Nuevo nombre', u.nombre); if (n) run(() => rpc('admin_set_nombre', { p_id: u.id, p_nombre: n }), 'Nombre actualizado.') }}><b>{u.nombre}</b> ✎</button></td><td data-label="Correo">{u.email}</td><td data-label="Rol">{u.rol}</td>
              <td data-label="Plaza">{u.rol === 'dispatcher' ? <button className="link" disabled={busy} onClick={() => { const p = prompt(`Nueva plaza para ${u.nombre}`, u.plaza ?? ''); if (p) run(() => rpc('admin_set_plaza', { p_id: u.id, p_plaza: p }), 'Plaza actualizada.') }}>{u.plaza ?? '—'} ✎</button> : '—'}</td>
              <td data-label="Estado">{u.activo === false ? <span className="pill bad">desactivado</span> : <span className="pill">activo</span>}</td>
              <td className="acciones row">
                <button className="link" disabled={busy} onClick={() => { const p = prompt(`Nueva contraseña para ${u.nombre} (mín. 6)`); if (p) run(() => admin({ accion: 'password', id: u.id, password: p }), 'Contraseña cambiada.') }}>Cambiar contraseña</button>
                {u.id !== perfil.id && <button className="link" disabled={busy} onClick={() => run(() => rpc('admin_set_activo', { p_id: u.id, p_activo: u.activo === false }), u.activo === false ? 'Usuario activado.' : 'Usuario desactivado.')}>{u.activo === false ? 'Activar' : 'Desactivar'}</button>}
              </td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  )
}
