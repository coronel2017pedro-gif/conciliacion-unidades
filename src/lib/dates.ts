export const MESES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 }

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** "10 sep 2026" -> "2026-09-10" */
export function parseFechaEs(s: string): string | null {
  const m = s.trim().toLowerCase().match(/(\d{1,2})\s+([a-záéíóú]{3})[a-z]*\.?\s+(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].slice(0, 3)]
  return mes ? iso(+m[3], mes, +m[1]) : null
}

export function toUtc(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}

export function addDays(d: string, n: number): string {
  const t = new Date(toUtc(d) + n * 86400000)
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000)
}

/** inclusive list of days */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}

/** Excel cell (Date | serial | string) -> ISO */
export function cellToIso(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number') {
    const t = new Date(Math.round((v - 25569) * 86400) * 1000)
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
  }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  return parseFechaEs(s)
}

export const normPlaca = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
