import { Component, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './lib/types'
import Incidencias from './pages/Incidencias'
import Unidades from './pages/Unidades'
import Facturas from './pages/Facturas'
import Rutas from './pages/Rutas'
import Conciliacion from './pages/Conciliacion'
import Usuarios from './pages/Usuarios'
import Bitacora from './pages/Bitacora'

function Login() {
  const [email, setEmail] = useState(''), [pass, setPass] = useState(''), [err, setErr] = useState('')
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pass })
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message)
    else supabase.rpc('log_evento', { p_accion: 'login', p_entidad: 'sesion' })
  }
  return (
    <form className="card login" onSubmit={entrar}>
      <h2>Conciliación de unidades</h2>
      <label>Correo</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <div style={{ height: 10 }} />
      <label>Contraseña</label><input type="password" value={pass} onChange={e => setPass(e.target.value)} required />
      {err && <div className="alert err">{err}</div>}
      <div style={{ height: 12 }} /><button className="btn" style={{ width: '100%' }}>Entrar</button>
    </form>
  )
}

/** Si algo falla al dibujar la pantalla, muestra el error en vez de dejar la página en blanco. */
class Fallo extends Component<{ children: ReactNode }, { e: Error | null }> {
  state = { e: null as Error | null }
  static getDerivedStateFromError(e: Error) { return { e } }
  render() {
    if (!this.state.e) return this.props.children
    return <main><div className="card"><h2>Algo falló al mostrar la pantalla</h2>
      <p className="mut">{this.state.e.message}</p>
      <button className="btn" onClick={() => location.reload()}>Recargar</button>{' '}
      <button className="btn sec" onClick={() => supabase.auth.signOut().finally(() => location.reload())}>Salir</button></div></main>
  }
}

export default function Root() { return <Fallo><App /></Fallo> }

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Profile | null | undefined>(undefined)
  const [tab, setTab] = useState('incidencias')
  const [nuevos, setNuevos] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!session) { setPerfil(undefined); return }
    let vivo = true
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { if (vivo) setPerfil((data as Profile) ?? null) }, () => { if (vivo) setPerfil(null) })
    return () => { vivo = false }
  }, [session?.user.id])

  // Aviso (punto rojo) de altas y cambios de plaza de los últimos 3 días
  useEffect(() => {
    if (!perfil || perfil.activo === false) { setNuevos(0); return }
    const desde = new Date(Date.now() - 3 * 86400000).toISOString()
    supabase.from('movimientos_unidades').select('id', { count: 'exact', head: true }).gte('creado_en', desde)
      .then(({ count, error }) => setNuevos(error ? 0 : count ?? 0), () => setNuevos(0))
  }, [perfil?.id, tab])

  if (!session) return <Login />
  if (perfil === undefined) return <main>Cargando…</main>
  if (perfil === null) return (
    <main><div className="card"><h2>Tu usuario no tiene perfil</h2>
      <p>Pide a sistemas que te dé de alta (rol y plaza) en la tabla <code>profiles</code>.</p>
      <button className="btn sec" onClick={() => supabase.auth.signOut()}>Salir</button></div></main>
  )

  if (perfil.activo === false) return (
    <main><div className="card"><h2>Usuario desactivado</h2><p>Contacta a sistemas.</p>
      <button className="btn sec" onClick={() => supabase.auth.signOut()}>Salir</button></div></main>
  )
  const admin = perfil.rol !== 'dispatcher'
  const master = perfil.rol === 'master'
  const tabs = admin
    ? [['incidencias', 'Incidencias'], ['unidades', 'Unidades'], ['facturas', 'Facturas'], ['rutas', 'Rutas'], ['conciliacion', 'Conciliación'], ['usuarios', 'Usuarios'], ...(master ? [['bitacora', 'Bitácora']] : [])]
    : [['incidencias', 'Incidencias de mis unidades'], ['unidades', 'Mis unidades']]
  return (
    <>
      <header>
        <h1>Conciliación de unidades</h1>
        <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'unidades' && nuevos > 0 && <span className="dot">{nuevos}</span>}</button>)}</nav>
        <span className="sp" />
        <small>{perfil.nombre} · {perfil.rol}{perfil.plaza ? ` · ${perfil.plaza}` : ''}</small>
        <button className="btn sec" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <main>
        {tab === 'incidencias' && <Incidencias perfil={perfil} />}
        {tab === 'unidades' && <Unidades perfil={perfil} />}
        {admin && tab === 'facturas' && <Facturas />}
        {admin && tab === 'rutas' && <Rutas />}
        {admin && tab === 'conciliacion' && <Conciliacion />}
        {admin && tab === 'usuarios' && <Usuarios perfil={perfil} />}
        {master && tab === 'bitacora' && <Bitacora />}
      </main>
    </>
  )
}
