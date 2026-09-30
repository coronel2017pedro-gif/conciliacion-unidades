import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

interface Reg { id: number; creado_en: string; usuario_nombre: string | null; accion: string; entidad: string | null; referencia: string | null; detalle: any }
const PAGINA = 200
const ACCIONES = ['insert', 'update', 'delete', 'login', 'carga_rutas', 'exportar_conciliacion', 'crear_usuario', 'cambiar_password', 'activar_usuario', 'desactivar_usuario', 'cambiar_plaza']

export default function Bitacora() {
  const [rows, setRows] = useState<Reg[]>([])
  const [f, setF] = useState({ usuario: '', accion: '', entidad: '', desde: '', hasta: '', texto: '' })
  const [abierto, setAbierto] = useState<number | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [err, setErr] = useState('')

  const cargar = async (desde = 0, append = false) => {
    let q = supabase.from('bitacora').select('*').order('id', { ascending: false }).range(desde, desde + PAGINA - 1)
    if (f.usuario) q = q.ilike('usuario_nombre', `%${f.usuario}%`)
    if (f.accion) q = q.eq('accion', f.accion)
    if (f.entidad) q = q.eq('entidad', f.entidad)
    if (f.desde) q = q.gte('creado_en', f.desde + 'T00:00:00-06:00')
    if (f.hasta) q = q.lte('creado_en', f.hasta + 'T23:59:59-06:00')
    if (f.texto) q = q.ilike('referencia', `%${f.texto}%`)
    const { data, error } = await q
    if (error) return setErr(error.message)
    setErr(''); setHayMas((data?.length ?? 0) === PAGINA)
    setRows(append ? [...rows, ...(data as Reg[])] : (data as Reg[]))
  }
  useEffect(() => { cargar() }, [])

  const cuando = (s: string) => new Date(s).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'medium' })
  return (
    <div className="card">
      <h2>Bitácora de movimientos</h2>
      <p className="mut" style={{ marginTop: 0 }}>Solo la ven los usuarios master. Se registra quién hizo cada alta, cambio o baja, y las cargas, exportaciones e inicios de sesión. No se puede editar ni borrar desde la app.</p>
      <form className="grid" onSubmit={e => { e.preventDefault(); cargar() }}>
        <div><label>Usuario</label><input value={f.usuario} onChange={e => setF({ ...f, usuario: e.target.value })} /></div>
        <div><label>Acción</label><select value={f.accion} onChange={e => setF({ ...f, accion: e.target.value })}><option value="">Todas</option>{ACCIONES.map(a => <option key={a}>{a}</option>)}</select></div>
        <div><label>Módulo</label><select value={f.entidad} onChange={e => setF({ ...f, entidad: e.target.value })}><option value="">Todos</option>{['incidencias', 'unidades', 'facturas', 'rutas', 'usuarios', 'conciliacion', 'sesion'].map(a => <option key={a}>{a}</option>)}</select></div>
        <div><label>Placa / folio / correo</label><input value={f.texto} onChange={e => setF({ ...f, texto: e.target.value })} /></div>
        <div><label>Desde</label><input type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} /></div>
        <div><label>Hasta</label><input type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} /></div>
        <div><button className="btn">Filtrar</button></div>
      </form>
      {err && <div className="alert err">{err}</div>}
      <div className="scroll" style={{ maxHeight: 640, marginTop: 10 }}><table>
        <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Referencia</th><th></th></tr></thead>
        <tbody>{rows.map(r => [
          <tr key={r.id}><td>{cuando(r.creado_en)}</td><td>{r.usuario_nombre ?? <span className="mut">—</span>}</td><td><span className="pill">{r.accion}</span></td><td>{r.entidad}</td><td>{r.referencia}</td>
            <td>{r.detalle && <button className="link" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>{abierto === r.id ? 'ocultar' : 'detalle'}</button>}</td></tr>,
          abierto === r.id && <tr key={r.id + 'd'}><td colSpan={6}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(r.detalle, null, 2)}</pre></td></tr>,
        ])}</tbody>
      </table></div>
      {hayMas && <div style={{ marginTop: 10 }}><button className="btn sec" onClick={() => cargar(rows.length, true)}>Cargar más</button></div>}
    </div>
  )
}
