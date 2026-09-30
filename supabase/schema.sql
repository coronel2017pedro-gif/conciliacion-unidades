-- Conciliación de unidades de renta — esquema para un proyecto de Supabase NUEVO.
-- Pégalo completo en: Supabase > SQL Editor > New query > Run.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('dispatcher','conciliacion','master')),
  plaza text,                                  -- solo aplica a dispatcher
  email text,
  activo boolean not null default true,
  creado_en timestamptz default now()
);

create table public.unidades (
  placa text primary key,
  plaza text, tipo text, vehiculo text, serie text, operador text,
  fecha_entrega date,
  activa boolean not null default true
);

create table public.incidencias (
  id uuid primary key default gen_random_uuid(),
  placa text not null references public.unidades(placa) on update cascade,
  tipo text not null check (tipo in ('taller','falla','llantas','sin_operador','siniestro','cambio_plaza','otro')),
  fecha_inicio date not null,
  fecha_fin date,                              -- null = sigue abierta
  descuenta boolean not null default true,     -- ¿es responsabilidad del arrendador (no se paga renta)?
  plaza text, plaza_destino text, notas text,
  creado_por uuid default auth.uid() references auth.users(id),
  creado_en timestamptz default now(),
  check (fecha_fin is null or fecha_fin >= fecha_inicio)
);
create index on public.incidencias (placa, fecha_inicio);

create table public.facturas (
  folio text primary key,
  fecha date, proveedor text,
  subtotal numeric(14,2), iva numeric(14,2), total numeric(14,2),
  folio_fiscal text unique,
  estatus text not null default 'vigente' check (estatus in ('vigente','sustituida','cancelada')),
  sustituida_por text,
  creado_en timestamptz default now()
);

create table public.factura_lineas (
  id uuid primary key default gen_random_uuid(),
  factura_folio text not null references public.facturas(folio) on delete cascade,
  factura_fecha date, linea int not null,
  placa text not null, serie text, vehiculo text, plaza text,
  inicio date not null, fin date not null, dias int not null,
  tarifa numeric(12,2) not null, subtotal numeric(14,2) not null,
  inicio_explicito boolean not null default false,
  unique (factura_folio, linea)
);
create index on public.factura_lineas (placa);

create table public.rutas (
  fecha date not null, placa text not null, id_ruta text not null,
  transportista text, despachados int, entregados int,
  primary key (fecha, placa, id_ruta)
);

-- ---------- Seguridad (RLS) ----------
create or replace function public.mi_rol() returns text language sql stable security definer set search_path = public
  as $$ select rol from public.profiles where id = auth.uid() and activo is not false $$;
create or replace function public.mi_plaza() returns text language sql stable security definer set search_path = public
  as $$ select plaza from public.profiles where id = auth.uid() and activo is not false $$;

alter table public.profiles enable row level security;
alter table public.unidades enable row level security;
alter table public.incidencias enable row level security;
alter table public.facturas enable row level security;
alter table public.factura_lineas enable row level security;
alter table public.rutas enable row level security;

create policy p_prof_sel on public.profiles for select using (id = auth.uid() or public.mi_rol() in ('conciliacion','master'));
create policy p_prof_all on public.profiles for all using (public.mi_rol() = 'master') with check (public.mi_rol() = 'master');

-- Unidades: el dispatcher solo ve las de su plaza; conciliación/master ven y editan todas
create policy p_uni_sel on public.unidades for select using (public.mi_rol() in ('conciliacion','master') or plaza = public.mi_plaza());
create policy p_uni_mod on public.unidades for all using (public.mi_rol() in ('conciliacion','master')) with check (public.mi_rol() in ('conciliacion','master'));

-- Incidencias: el dispatcher registra/edita las de su plaza; no borra
create policy p_inc_sel on public.incidencias for select using (public.mi_rol() in ('conciliacion','master') or plaza = public.mi_plaza());
create policy p_inc_ins on public.incidencias for insert with check (public.mi_rol() in ('conciliacion','master') or (public.mi_rol() = 'dispatcher' and plaza = public.mi_plaza()));
create policy p_inc_upd on public.incidencias for update using (public.mi_rol() in ('conciliacion','master') or (public.mi_rol() = 'dispatcher' and plaza = public.mi_plaza()));
create policy p_inc_del on public.incidencias for delete using (public.mi_rol() in ('conciliacion','master'));

-- Facturas y rutas: solo conciliación/master (los dispatchers no ven montos)
create policy p_fac on public.facturas for all using (public.mi_rol() in ('conciliacion','master')) with check (public.mi_rol() in ('conciliacion','master'));
create policy p_fl on public.factura_lineas for all using (public.mi_rol() in ('conciliacion','master')) with check (public.mi_rol() in ('conciliacion','master'));
create policy p_rut on public.rutas for all using (public.mi_rol() in ('conciliacion','master')) with check (public.mi_rol() in ('conciliacion','master'));

-- ---------- Bitácora (solo lectura para master) ----------
create table public.bitacora (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  usuario_id uuid, usuario_nombre text,
  accion text not null,            -- insert / update / delete / login / carga_rutas / exportar / crear_usuario ...
  entidad text,                    -- tabla u objeto afectado
  referencia text,                 -- placa, folio, id, correo...
  detalle jsonb
);
create index on public.bitacora (creado_en desc);
alter table public.bitacora enable row level security;
create policy p_bit_sel on public.bitacora for select using (public.mi_rol() = 'master');
-- Nadie inserta/edita/borra directo: solo los triggers y log_evento() (security definer)

create or replace function public.trg_bitacora() returns trigger language plpgsql security definer set search_path = public as $$
declare v_nombre text; v_ref text; v_det jsonb;
begin
  select nombre into v_nombre from public.profiles where id = auth.uid();
  v_ref := coalesce(to_jsonb(new)->>tg_argv[0], to_jsonb(old)->>tg_argv[0]);
  if tg_op = 'INSERT' then v_det := to_jsonb(new);
  elsif tg_op = 'UPDATE' then v_det := jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new));
  else v_det := to_jsonb(old); end if;
  insert into public.bitacora (usuario_id, usuario_nombre, accion, entidad, referencia, detalle)
  values (auth.uid(), v_nombre, lower(tg_op), tg_table_name, v_ref, v_det);
  return coalesce(new, old);
end $$;

create trigger bit_incidencias after insert or update or delete on public.incidencias for each row execute function public.trg_bitacora('id');
create trigger bit_unidades after insert or delete on public.unidades for each row execute function public.trg_bitacora('placa');
create trigger bit_unidades_upd after update on public.unidades for each row when (old.* is distinct from new.*) execute function public.trg_bitacora('placa');
create trigger bit_facturas after insert or update or delete on public.facturas for each row execute function public.trg_bitacora('folio');

create or replace function public.log_evento(p_accion text, p_entidad text default null, p_referencia text default null, p_detalle jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  select nombre into v_nombre from public.profiles where id = auth.uid();
  insert into public.bitacora (usuario_id, usuario_nombre, accion, entidad, referencia, detalle)
  values (auth.uid(), v_nombre, p_accion, p_entidad, p_referencia, p_detalle);
end $$;
grant execute on function public.log_evento(text, text, text, jsonb) to authenticated;

-- ---------- Usuarios ----------
-- Los usuarios se crean desde la app (pestaña Usuarios) mediante la Edge Function admin-usuarios.
-- Los dos usuarios master iniciales se crean con: node scripts/crearMasters.mjs  (ver README)

-- ---------- (Alternativa manual) Primer usuario ----------
-- 1) Authentication > Users > Add user (correo y contraseña)
-- 2) Copia su UUID y ejecuta (cambia los valores):
-- insert into public.profiles (id, nombre, rol) values ('UUID-AQUI', 'Pedro', 'master');
-- Para un dispatcher:
-- insert into public.profiles (id, nombre, rol, plaza) values ('UUID-AQUI', 'Nombre', 'dispatcher', 'IRAPUATO');

-- Activar/desactivar, cambiar plaza y nombre: ver supabase/migracion_usuarios_activo.sql (ejecútalo después de este archivo)
