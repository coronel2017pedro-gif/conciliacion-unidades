// Crea (o actualiza) los usuarios master iniciales. Se corre UNA vez, después de ejecutar schema.sql.
//   SUPABASE_URL=https://xxxx.supabase.co SERVICE_ROLE_KEY=eyJ... node scripts/crearMasters.mjs
// La service_role key está en Supabase > Settings > API. NUNCA la pongas en el .env de la app ni en Netlify.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL, key = process.env.SERVICE_ROLE_KEY
if (!url || !key) { console.error('Faltan SUPABASE_URL y/o SERVICE_ROLE_KEY'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false } })

const masters = [
  { email: 'coronel2017pedro@gmail.com', password: 'Chacho0075', nombre: 'Pedro Coronel' },
  { email: 'carloale17@hotmail.com', password: 'admin123', nombre: 'Carlos Coronel' },
]

for (const m of masters) {
  let id
  const { data, error } = await admin.auth.admin.createUser({ email: m.email, password: m.password, email_confirm: true })
  if (error) {
    // ya existe: buscarlo y actualizar contraseña
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const ex = lista?.users.find(u => u.email?.toLowerCase() === m.email)
    if (!ex) { console.error(m.email, '->', error.message); continue }
    id = ex.id
    await admin.auth.admin.updateUserById(id, { password: m.password, email_confirm: true })
  } else id = data.user.id
  const { error: e2 } = await admin.from('profiles').upsert({ id, nombre: m.nombre, rol: 'master', plaza: null, email: m.email, activo: true })
  console.log(m.email, e2 ? 'ERROR perfil: ' + e2.message : 'listo (master)')
}
