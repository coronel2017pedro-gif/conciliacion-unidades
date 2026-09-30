-- Reporte de capacidad de Mercado Libre (informativo): unidades solicitadas/asignadas y si salieron a ruta.
-- Seguro de correr varias veces.
create table if not exists public.capacidad (
  id bigint generated always as identity primary key,
  placa text not null,
  actualizado timestamp not null,          -- "Última actualización" del reporte (sin zona horaria)
  service_center text, vehiculo text, transportista text, id_ruta text,
  solicitado boolean not null default false, confirmado boolean not null default false,
  asignado boolean not null default false, escaneado boolean not null default false, ejecutado boolean not null default false,
  unique (placa, actualizado)
);
alter table public.capacidad enable row level security;
drop policy if exists p_cap on public.capacidad;
create policy p_cap on public.capacidad for all using (public.mi_rol() in ('conciliacion','master')) with check (public.mi_rol() in ('conciliacion','master'));
