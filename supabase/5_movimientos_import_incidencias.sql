-- Registra en el semáforo (movimientos_unidades): 1) lo que cambia al importar el Excel de inventario, 2) las incidencias que capturan los dispatchers.
-- Requiere haber corrido antes migracion_movimientos_unidades.sql. Es seguro correrlo varias veces. Ejecútalo en Supabase > SQL Editor.

-- Nuevos tipos de movimiento
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.movimientos_unidades'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%tipo%' loop
    execute format('alter table public.movimientos_unidades drop constraint %I', c);
  end loop;
end $$;
alter table public.movimientos_unidades add constraint movimientos_unidades_tipo_check
  check (tipo in ('alta','cambio_plaza','reactivacion','incidencia','incidencia_cierre'));

-- Importación de inventario: actualiza unidades y deja registrado cada alta, cambio de plaza o reactivación. Las celdas vacías NO borran datos existentes.
create or replace function public.importar_inventario(p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yo public.profiles; r jsonb; u public.unidades;
  v_placa text; v_plaza text; n_alta int := 0; n_cambio int := 0; n_react int := 0; n_igual int := 0;
begin
  select * into yo from public.profiles where id = auth.uid();
  if yo.id is null or yo.activo is false or yo.rol not in ('conciliacion','master') then raise exception 'Sin permiso'; end if;

  for r in select * from jsonb_array_elements(p_filas) loop
    v_placa := upper(regexp_replace(coalesce(r->>'placa',''), '[^A-Za-z0-9]', '', 'g'));
    if v_placa = '' then continue; end if;
    v_plaza := nullif(upper(trim(coalesce(r->>'plaza',''))), '');
    select * into u from public.unidades where placa = v_placa for update;

    if not found then
      insert into public.unidades (placa, plaza, vehiculo, tipo, serie, operador, fecha_entrega, activa)
      values (v_placa, v_plaza, nullif(r->>'vehiculo',''), nullif(r->>'tipo',''), nullif(r->>'serie',''), nullif(r->>'operador',''), nullif(r->>'fecha_entrega','')::date, true);
      insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre, notas)
      values (v_placa, 'alta', null, v_plaza, yo.id, yo.nombre, 'Importación de inventario');
      n_alta := n_alta + 1;
    else
      if v_plaza is not null and upper(coalesce(u.plaza,'')) <> v_plaza then
        insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre, notas)
        values (v_placa, 'cambio_plaza', u.plaza, v_plaza, yo.id, yo.nombre, 'Importación de inventario');
        n_cambio := n_cambio + 1;
      elsif u.activa is false then
        insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre, notas)
        values (v_placa, 'reactivacion', u.plaza, u.plaza, yo.id, yo.nombre, 'Importación de inventario');
        n_react := n_react + 1;
      else n_igual := n_igual + 1; end if;
      update public.unidades set
        plaza = coalesce(v_plaza, plaza), activa = true,
        vehiculo = coalesce(nullif(r->>'vehiculo',''), vehiculo), tipo = coalesce(nullif(r->>'tipo',''), tipo),
        serie = coalesce(nullif(r->>'serie',''), serie), operador = coalesce(nullif(r->>'operador',''), operador),
        fecha_entrega = coalesce(nullif(r->>'fecha_entrega','')::date, fecha_entrega)
      where placa = v_placa;
    end if;
  end loop;
  return jsonb_build_object('altas', n_alta, 'cambios_plaza', n_cambio, 'reactivadas', n_react, 'sin_cambio', n_igual);
end $$;
grant execute on function public.importar_inventario(jsonb) to authenticated;

-- Incidencias: cada una que se captura (o se cierra) queda en el semáforo. Un traslado se registra como cambio de plaza.
create or replace function public.trg_mov_incidencia() returns trigger language plpgsql security definer set search_path = public as $$
declare yo public.profiles; v_tipo text; v_notas text;
begin
  select * into yo from public.profiles where id = auth.uid();
  v_tipo := case new.tipo when 'taller' then 'Taller / mantenimiento' when 'falla' then 'Falla mecánica' when 'llantas' then 'Llantas'
    when 'siniestro' then 'Siniestro' when 'sin_operador' then 'Sin operador' when 'cambio_plaza' then 'Traslado' else 'Otro' end;
  if tg_op = 'INSERT' then
    v_notas := v_tipo || ' · desde ' || new.fecha_inicio || coalesce(' · ' || nullif(new.notas,''), '');
    if new.tipo = 'cambio_plaza' and coalesce(new.plaza_destino,'') <> '' then
      insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre, notas)
      values (new.placa, 'cambio_plaza', new.plaza, upper(new.plaza_destino), yo.id, yo.nombre, 'Traslado capturado en incidencias · ' || new.fecha_inicio);
    else
      insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre, notas)
      values (new.placa, 'incidencia', new.plaza, new.plaza, yo.id, yo.nombre, v_notas);
    end if;
  elsif new.fecha_fin is not null and old.fecha_fin is null and new.tipo <> 'cambio_plaza' then
    insert into public.movimientos_unidades (placa, tipo, plaza_origen, plaza_destino, usuario_id, usuario_nombre, notas)
    values (new.placa, 'incidencia_cierre', new.plaza, new.plaza, yo.id, yo.nombre, v_tipo || ' · cerrada ' || new.fecha_fin);
  end if;
  return new;
end $$;
drop trigger if exists mov_incidencias on public.incidencias;
create trigger mov_incidencias after insert or update on public.incidencias for each row execute function public.trg_mov_incidencia();
