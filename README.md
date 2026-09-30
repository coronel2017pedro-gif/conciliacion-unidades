# Conciliación de unidades de renta

App web (React + Vite + Supabase) para empatar **lo que factura el arrendador** contra **lo que realmente operó**:

1. Los **dispatchers** registran incidencias de sus unidades (taller, falla, llantas…) con fecha de inicio y fin.
2. Sistemas/nómina sube las **facturas PDF** del arrendador, el **inventario** y el **reporte de rutas** de Mercado Libre.
3. La pestaña **Conciliación** cruza todo día por día y calcula cuánto descontar.

## Reglas de conciliación (por placa y día facturado)
Prioridad: **Duplicado** > **Antes de entrega** > **Incidencia** > **Operó / Sin ruta**.
- *Duplicado*: ese día de esa placa ya se cobró en otra factura vigente (la más antigua se respeta).
- *Antes de entrega*: se cobra antes de la fecha de entrega del inventario.
- *Incidencia*: el dispatcher registró taller/falla/llantas/siniestro con "descuenta" activo → se descuenta.
- *Sin ruta* y sin incidencia: **no se descuenta**, queda "por justificar" (se puede activar el modo agresivo).
- Convención de BE: en "INICIO DE RENTA dd/mm" el día de entrega no se cobra (10→15 = 5 días).
- Otras observaciones: placa fuera de inventario, plaza distinta a la del inventario, tarifa × días ≠ importe, rutas en días con incidencia.
- Re-facturaciones: si una factura nueva repite el periodo y las placas de otra, se sugiere marcar la anterior como **sustituida**.

## Instalación
1. Crea un proyecto **nuevo** en Supabase y ejecuta `supabase/schema.sql` en el SQL Editor (crea tablas, permisos, bitácora).
2. **Edge Function de usuarios** (para dar de alta desde la app): Supabase > *Edge Functions* > *Deploy a new function* > nómbrala exactamente `admin-usuarios` y pega el contenido de `supabase/functions/admin-usuarios/index.ts`. (Con CLI: `supabase functions deploy admin-usuarios`.)
3. **Usuarios master iniciales**: copia la `service_role` key (Settings > API) y corre una sola vez
   `SUPABASE_URL=https://xxxx.supabase.co SERVICE_ROLE_KEY=eyJ... node scripts/crearMasters.mjs`
   Crea a coronel2017pedro@gmail.com y carloale17@hotmail.com como master. La service_role **nunca** va en `.env` ni en Netlify.
4. `cp .env.example .env` y pon `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (la anon/public).
5. `npm install && npm run dev`. Para publicar: `npm run build` (Netlify ya trae `netlify.toml`; agrega esas 2 variables).

## Usuarios
Pestaña **Usuarios**: master da de alta a cualquiera (dispatcher, conciliación, master); conciliación solo dispatchers. Cada uno entra con su correo y contraseña. Se puede cambiar contraseña, cambiar la plaza de un dispatcher y desactivar/activar (un desactivado no puede entrar).

## Bitácora (solo master)
Pestaña **Bitácora**: quién, cuándo y qué. Altas/cambios/bajas de incidencias, unidades y facturas se registran con triggers de base de datos (con el valor anterior y el nuevo); además cargas de rutas, exportaciones, altas y cambios de usuarios e inicios de sesión. Nadie puede editarla ni borrarla desde la app.

## Roles
| Rol | Ve | Puede |
|---|---|---|
| dispatcher | solo unidades/incidencias de **su plaza**, sin montos | registrar y cerrar incidencias |
| conciliacion | todo menos la bitácora | cargar facturas/rutas/inventario, conciliar, exportar, dar de alta dispatchers |
| master | todo, incluida la bitácora | además crea usuarios de cualquier rol |

## Pruebas con los archivos reales
`npm run test:pdf` (lector de PDF) · `npm run test:recon` (motor + Excel de ejemplo) — las rutas de los archivos están en `scripts/`.

## Publicación automática (GitHub + Netlify)
- Cada `git push` a la rama `main` publica solo la nueva versión en Netlify (~1 min). No se sube nada a mano.
- Variables en Netlify (Site configuration > Environment variables), solo dos: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (la clave *publishable/anon*). Nunca la secret/service_role.
- Cambios de la base de datos (archivos `supabase/migracion_*.sql`) se corren a mano una vez en el SQL Editor de Supabase; la Edge Function se re-despliega desde Supabase.
- Flujo para un ajuste: cambiar código → `git add . && git commit -m "ajuste" && git push`.
