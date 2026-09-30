import { createRoot } from 'react-dom/client'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.render(
    <main><div className="card">
      <h2>Falta configurar Supabase</h2>
      <p>No encontré <code>VITE_SUPABASE_URL</code> y/o <code>VITE_SUPABASE_ANON_KEY</code>.</p>
      <ol>
        <li>En la carpeta del proyecto debe existir un archivo llamado exactamente <code>.env</code> (no <code>.env.example</code> ni <code>.env.txt</code>).</li>
        <li>Con dos líneas: <code>VITE_SUPABASE_URL=https://xxxx.supabase.co</code> y <code>VITE_SUPABASE_ANON_KEY=...</code> (sin comillas ni espacios).</li>
        <li>Detén el servidor (Ctrl+C) y vuelve a correr <code>npm run dev</code>: Vite solo lee el <code>.env</code> al arrancar.</li>
      </ol>
    </div></main>,
  )
} else {
  import('./App').then(({ default: App }) => root.render(<App />))
}
