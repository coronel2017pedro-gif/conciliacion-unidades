-- Alta de unidades por dispatcher / conciliación / master, con cambio de plaza automático y registro de movimientos.
-- Es seguro correrlo varias veces. Ejecútalo en Supabase > SQL Editor.

create table if not exists public.movimientos_unidades (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  placa text not null,
  tipo text not null check (tipo in ('alta','cambio_plaza','reactivacion')),
  plaza_origen text,
  plaza_destino text,
  usuario_id uuid,
  usuario_nombre text,
  notas text
);
create index if not exists movimientos_unidades_fecha on public.movimientos_unidades (creado_en desc);
alter table public.movimientos_unidades enable row level security;
drop policy if exists p_mov_sel on public.movimientos_unidades;
-- conciliación/master ven todo; el dispatcher solo los movimientos que salen de o llegan a su plaza. Nadie escribe directo: solo la función.
create policy p_mov_sel on public.movimientos_unidades for select
  using (public.mi_rol() in ('conciliacion','master') or plaza_origen = public.mi_plaza() or plaza_destino = public.mi_plaza());

create or replace function public.registrar_unidad(
  p_placa text, p_plaza text default null, p_vehiculo text default null, p_tipo text default null,
  p_serie text default null, p_operador text default null, p_fecha_entrega date default null, p_confirmar boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yo public.profiles; u public.unidades;
  v_placa text; v_plaza text;
begin
  select * into yo from public.profiles where id = auth.uid();
  if yo.id is null or yo.activo is false or yo.rol not in ('dispatcher','conciliacion','master') then raise exception 'Sin permiso'; end if;

  v_placa := upper(regexp_replace(coalesce(p_placa,''), '[^A-Za-z0-9]', '', 'g'));
  if v_placa = '' then raise exception 'Escribe la placa'; end if;
  v_plaza := case when yo.rol = 'dispatcher' then upper(trim(coalesce(yo.plaza,''))) else upper(trim(coalesce(p_plaza,''))) end;
  if v_plaza = '' then raise exception 'Indica la plaza de la unidad'; end if;

  select * into u from public.unidades where placa = v_placa for update;

  -- Unidad nueva
  if not found then
    insert into public.unidades (placa, plaza, tipo, vehiculo, serie, operador, fecha_entrega, activa)
    values (v_placa, v_plaza, nullif(trim(p_tipo),''), nullif(trim(p_vehiculo),''), nullif(trim(p_serie),''), nullif(trim(p_operador),''), p_fecha_entrega, true);
    insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre)
    values (v_placa, 'alta', null, v_plaza, yo.id, yo.nombre);
    return jsonb_build_object('estado','alta','placa',v_placa,'plaza',v_plaza);
  end if;

  -- Misma plaza
  if upper(coalesce(u.plaza,'')) = v_plaza then
    if u.activa then return jsonb_build_object('estado','ya_existe','placa',v_placa,'plaza',v_plaza); end if;
    update public.unidades set activa = true,
      vehiculo = coalesce(nullif(trim(p_vehiculo),''), vehiculo), tipo = coalesce(nullif(trim(p_tipo),''), tipo),
      serie = coalesce(nullif(trim(p_serie),''), serie), operador = coalesce(nullif(trim(p_operador),''), operador)
    where placa = v_placa;
    insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre)
    values (v_placa, 'reactivacion', v_plaza, v_plaza, yo.id, yo.nombre);
    return jsonb_build_object('estado','reactivada','placa',v_placa,'plaza',v_plaza);
  end if;

  -- Está en otra plaza: cambio de plaza (pide confirmación)
  if not p_confirmar then
    return jsonb_build_object('estado','requiere_confirmacion','placa',v_placa,'plaza_actual',u.plaza,'plaza_nueva',v_plaza);
  end if;
  update public.unidades set plaza = v_plaza, activa = true,
    vehiculo = coalesce(nullif(trim(p_vehiculo),''), vehiculo), tipo = coalesce(nullif(trim(p_tipo),''), tipo),
    serie = coalesce(nullif(trim(p_serie),''), serie), operador = coalesce(nullif(trim(p_operador),''), operador)
  where placa = v_placa;   -- la fecha de entrega original NO cambia
  insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre)
  values (v_placa, 'cambio_plaza', u.plaza, v_plaza, yo.id, yo.nombre);
  insert into public.bitacora (usuario_id, usuario_nombre, accion, entidad, referencia, detalle)
  values (yo.id, yo.nombre, 'cambio_plaza_unidad', 'unidades', v_placa, jsonb_build_object('origen', u.plaza, 'destino', v_plaza));
  return jsonb_build_object('estado','cambio_plaza','placa',v_placa,'origen',u.plaza,'destino',v_plaza);
end $$;
grant execute on function public.registrar_unidad(text,text,text,text,text,text,date,boolean) to authenticated;
