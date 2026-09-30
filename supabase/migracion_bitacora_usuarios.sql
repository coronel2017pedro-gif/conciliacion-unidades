-- Migración SEGURA (se puede correr varias veces): agrega usuarios activos/correo y la bitácora
-- a un proyecto donde ya se había corrido una versión anterior de schema.sql.
-- Úsala SOLO si la tabla "bitacora" no existe todavía.

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists activo boolean not null default true;

create table if not exists public.bitacora (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  usuario_id uuid, usuario_nombre text,
  accion text not null, entidad text, referencia text, detalle jsonb
);
create index if not exists bitacora_creado_en_idx on public.bitacora (creado_en desc);
alter table public.bitacora enable row level security;
drop policy if exists p_bit_sel on public.bitacora;
create policy p_bit_sel on public.bitacora for select using (public.mi_rol() = 'master');

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

drop trigger if exists bit_incidencias on public.incidencias;
create trigger bit_incidencias after insert or update or delete on public.incidencias for each row execute function public.trg_bitacora('id');
drop trigger if exists bit_unidades on public.unidades;
create trigger bit_unidades after insert or delete on public.unidades for each row execute function public.trg_bitacora('placa');
drop trigger if exists bit_unidades_upd on public.unidades;
create trigger bit_unidades_upd after update on public.unidades for each row when (old.* is distinct from new.*) execute function public.trg_bitacora('placa');
drop trigger if exists bit_facturas on public.facturas;
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
