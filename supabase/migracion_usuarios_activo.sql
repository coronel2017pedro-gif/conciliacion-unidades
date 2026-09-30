-- Desactivar / activar usuarios y cambiar plaza SIN depender de la Edge Function.
-- Es seguro correrlo varias veces.

-- 1) Un usuario desactivado pierde todos sus permisos (RLS lo trata como sin rol)
create or replace function public.mi_rol() returns text language sql stable security definer set search_path = public
  as $$ select rol from public.profiles where id = auth.uid() and activo is not false $$;
create or replace function public.mi_plaza() returns text language sql stable security definer set search_path = public
  as $$ select plaza from public.profiles where id = auth.uid() and activo is not false $$;

-- 2) Activar / desactivar
create or replace function public.admin_set_activo(p_id uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare yo public.profiles; obj public.profiles;
begin
  select * into yo from public.profiles where id = auth.uid();
  if yo.id is null or yo.activo is false or yo.rol not in ('master','conciliacion') then raise exception 'Sin permiso'; end if;
  select * into obj from public.profiles where id = p_id;
  if obj.id is null then raise exception 'Usuario no encontrado'; end if;
  if obj.id = yo.id then raise exception 'No puedes desactivarte a ti mismo'; end if;
  if yo.rol <> 'master' and obj.rol <> 'dispatcher' then raise exception 'No puedes modificar a este usuario'; end if;
  update public.profiles set activo = p_activo where id = p_id;
  insert into public.bitacora (usuario_id, usuario_nombre, accion, entidad, referencia, detalle)
  values (yo.id, yo.nombre, case when p_activo then 'activar_usuario' else 'desactivar_usuario' end, 'usuarios', coalesce(obj.email, obj.id::text), jsonb_build_object('nombre', obj.nombre));
end $$;
grant execute on function public.admin_set_activo(uuid, boolean) to authenticated;

-- 3) Cambiar plaza de un dispatcher
create or replace function public.admin_set_plaza(p_id uuid, p_plaza text)
returns void language plpgsql security definer set search_path = public as $$
declare yo public.profiles; obj public.profiles;
begin
  select * into yo from public.profiles where id = auth.uid();
  if yo.id is null or yo.activo is false or yo.rol not in ('master','conciliacion') then raise exception 'Sin permiso'; end if;
  select * into obj from public.profiles where id = p_id;
  if obj.id is null or obj.rol <> 'dispatcher' then raise exception 'Solo aplica a dispatchers'; end if;
  if coalesce(trim(p_plaza),'') = '' then raise exception 'Falta la plaza'; end if;
  update public.profiles set plaza = upper(trim(p_plaza)) where id = p_id;
  insert into public.bitacora (usuario_id, usuario_nombre, accion, entidad, referencia, detalle)
  values (yo.id, yo.nombre, 'cambiar_plaza', 'usuarios', coalesce(obj.email, obj.id::text), jsonb_build_object('antes', obj.plaza, 'despues', upper(trim(p_plaza))));
end $$;
grant execute on function public.admin_set_plaza(uuid, text) to authenticated;

-- 4) Cambiar nombre (útil para corregir el "Nombre del dispatcher" provisional)
create or replace function public.admin_set_nombre(p_id uuid, p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare yo public.profiles; obj public.profiles;
begin
  select * into yo from public.profiles where id = auth.uid();
  if yo.id is null or yo.activo is false or yo.rol not in ('master','conciliacion') then raise exception 'Sin permiso'; end if;
  select * into obj from public.profiles where id = p_id;
  if obj.id is null then raise exception 'Usuario no encontrado'; end if;
  if yo.rol <> 'master' and obj.rol <> 'dispatcher' then raise exception 'No puedes modificar a este usuario'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'Falta el nombre'; end if;
  update public.profiles set nombre = trim(p_nombre) where id = p_id;
  insert into public.bitacora (usuario_id, usuario_nombre, accion, entidad, referencia, detalle)
  values (yo.id, yo.nombre, 'cambiar_nombre', 'usuarios', coalesce(obj.email, obj.id::text), jsonb_build_object('antes', obj.nombre, 'despues', trim(p_nombre)));
end $$;
grant execute on function public.admin_set_nombre(uuid, text) to authenticated;
