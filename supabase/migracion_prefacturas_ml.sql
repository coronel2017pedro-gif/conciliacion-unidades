-- Prefacturas de pago de Mercado Libre (ingreso). Ejecútalo en Supabase > SQL Editor.
create table if not exists public.prefacturas_ml (
  id_prefactura text primary key,
  tipo text not null,               -- Regular / Complementaria
  subtipo text,                     -- p. ej. Controles Internos
  periodo text not null,            -- 202609Q1 = 1 al 15 de sep; Q2 = 16 a fin de mes
  total numeric(14,2) not null,     -- "Total prefactura" (sin IVA); negativo = descuento de ML
  estado text,
  ultima_modificacion date,
  nro_comprobante text,
  fecha_carga date,
  subtotal numeric(14,2),
  total_con_iva numeric(14,2),
  id_sap text
);
alter table public.prefacturas_ml enable row level security;
drop policy if exists p_pml on public.prefacturas_ml;
create policy p_pml on public.prefacturas_ml for all using (public.mi_rol() in ('conciliacion','master')) with check (public.mi_rol() in ('conciliacion','master'));
