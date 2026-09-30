import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL ?? '', import.meta.env.VITE_SUPABASE_ANON_KEY ?? '')

/** Supabase devuelve máx. 1000 filas por consulta; esto pagina hasta traer todo. */
export async function fetchAll<T>(tabla: string, orden = 'created_at', filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(tabla).select('*').range(from, from + 999)
    if (orden) q = q.order(orden)
    if (filtro) q = filtro(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function insertarEnLotes(tabla: string, filas: object[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }, lote = 500) {
  for (let i = 0; i < filas.length; i += lote) {
    const { error } = await supabase.from(tabla).upsert(filas.slice(i, i + lote), opts)
    if (error) throw error
  }
}
