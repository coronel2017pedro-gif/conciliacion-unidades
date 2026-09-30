// Edge Function: alta y administración de usuarios desde la app.
// master: crea/edita cualquier rol. conciliacion: solo dispatchers.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: u } = await admin.auth.getUser(token)
    if (!u?.user) return json({ error: 'No autenticado' }, 401)
    const { data: yo } = await admin.from('profiles').select('*').eq('id', u.user.id).maybeSingle()
    if (!yo || !yo.activo || !['master', 'conciliacion'].includes(yo.rol)) return json({ error: 'Sin permiso' }, 403)

    const b = await req.json()
    const log = (accion: string, referencia: string, detalle: unknown) =>
      admin.from('bitacora').insert({ usuario_id: yo.id, usuario_nombre: yo.nombre, accion, entidad: 'usuarios', referencia, detalle })
    const puedeSobre = (rol: string) => yo.rol === 'master' || rol === 'dispatcher'

    if (b.accion === 'crear') {
      const email = String(b.email ?? '').trim().toLowerCase()
      const nombre = String(b.nombre ?? '').trim()
      if (!email || !nombre || String(b.password ?? '').length < 6) return json({ error: 'Nombre, correo y contraseña (mínimo 6 caracteres) son obligatorios' }, 400)
      if (!['dispatcher', 'conciliacion', 'master'].includes(b.rol) || !puedeSobre(b.rol)) return json({ error: 'No puedes crear ese rol' }, 403)
      if (b.rol === 'dispatcher' && !b.plaza) return json({ error: 'El dispatcher necesita una plaza' }, 400)
      const { data, error } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true })
      if (error) return json({ error: error.message.includes('already') ? 'Ese correo ya está registrado' : error.message }, 400)
      const { error: e2 } = await admin.from('profiles').insert({ id: data.user.id, nombre, rol: b.rol, plaza: b.rol === 'dispatcher' ? String(b.plaza).toUpperCase() : null, email })
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400) }
      await log('crear_usuario', email, { nombre, rol: b.rol, plaza: b.plaza ?? null })
      return json({ ok: true, id: data.user.id, version: 2 })
    }

    const { data: obj } = await admin.from('profiles').select('*').eq('id', b.id).maybeSingle()
    if (!obj) return json({ error: 'Usuario no encontrado' }, 404)
    if (!puedeSobre(obj.rol)) return json({ error: 'No puedes modificar a este usuario' }, 403)

    if (b.accion === 'password') {
      if (String(b.password ?? '').length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, 400)
      const { error } = await admin.auth.admin.updateUserById(obj.id, { password: b.password })
      if (error) return json({ error: error.message }, 400)
      await log('cambiar_password', obj.email ?? obj.id, { nombre: obj.nombre })
      return json({ ok: true })
    }
    if (b.accion === 'correo') {
      const nuevo = String(b.email ?? '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nuevo)) return json({ error: 'Escribe un correo válido' }, 400)
      if (nuevo === (obj.email ?? '').toLowerCase()) return json({ error: 'Ese ya es su correo' }, 400)
      const { error } = await admin.auth.admin.updateUserById(obj.id, { email: nuevo, email_confirm: true })
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Ese correo ya lo usa otro usuario' : error.message }, 400)
      const { error: e2 } = await admin.from('profiles').update({ email: nuevo }).eq('id', obj.id)
      if (e2) return json({ error: e2.message }, 400)
      await log('cambiar_correo', nuevo, { nombre: obj.nombre, antes: obj.email, despues: nuevo })
      return json({ ok: true })
    }
    if (b.accion === 'activo') {
      if (obj.id === yo.id) return json({ error: 'No puedes desactivarte a ti mismo' }, 400)
      const { error } = await admin.auth.admin.updateUserById(obj.id, { ban_duration: b.activo ? 'none' : '876000h' })
      if (error) return json({ error: error.message }, 400)
      await admin.from('profiles').update({ activo: !!b.activo }).eq('id', obj.id)
      await log(b.activo ? 'activar_usuario' : 'desactivar_usuario', obj.email ?? obj.id, { nombre: obj.nombre })
      return json({ ok: true })
    }
    if (b.accion === 'plaza') {
      if (obj.rol !== 'dispatcher' || !b.plaza) return json({ error: 'Solo aplica a dispatchers' }, 400)
      await admin.from('profiles').update({ plaza: String(b.plaza).toUpperCase() }).eq('id', obj.id)
      await log('cambiar_plaza', obj.email ?? obj.id, { antes: obj.plaza, despues: String(b.plaza).toUpperCase() })
      return json({ ok: true })
    }
    return json({ error: 'Acción desconocida' }, 400)
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500)
  }
})
