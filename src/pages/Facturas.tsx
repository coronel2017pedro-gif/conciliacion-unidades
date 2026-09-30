import { useEffect, useState } from 'react'
import { fetchAll, insertarEnLotes, supabase } from '../supabase'
import { parseInvoiceItems } from '../lib/parseInvoicePdf'
import { pdfItems } from '../lib/pdfItemsBrowser'
import { leerLibro, parseDesgloseFacturas } from '../lib/parseExcel'
import { posiblesRefacturas } from '../lib/reconcile'
import type { Factura, FacturaLinea } from '../lib/types'

type Fila = Factura & { estatus: string; sustituida_por: string | null }
const fmt = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

export default function Facturas() {
  const [facts, setFacts] = useState<Fila[]>([])
  const [lineas, setLineas] = useState<FacturaLinea[]>([])
  const [prev, setPrev] = useState<{ factura: Factura; lineas: FacturaLinea[]; avisos: string[] }[]>([])
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const cargar = async () => {
    const [f, l] = await Promise.all([fetchAll<Fila>('facturas', 'folio'), fetchAll<FacturaLinea>('factura_lineas', 'factura_folio')])
    setFacts(f); setLineas(l)
  }
  useEffect(() => { cargar().catch(e => setMsg({ t: e.message })) }, [])

  const leer = async (files: FileList) => {
    setMsg(null); const out: typeof prev = []
    try {
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer()
        if (/\.pdf$/i.test(file.name)) out.push(parseInvoiceItems(await pdfItems(buf)))
        else {
          // Excel de desglose ya elaborado: se agrupa por factura
          const ls = parseDesgloseFacturas(leerLibro(buf))
          for (const folio of [...new Set(ls.map(l => l.factura_folio))]) {
            const mine = ls.filter(l => l.factura_folio === folio)
            const sub = Math.round(mine.reduce((s, l) => s + l.subtotal, 0) * 100) / 100
            out.push({ factura: { folio, fecha: mine[0].factura_fecha, proveedor: 'BE ARRENDADORA', subtotal: sub, iva: Math.round(sub * 16) / 100, total: Math.round(sub * 116) / 100, folio_fiscal: null }, lineas: mine, avisos: [] })
          }
        }
      }
      setPrev(out)
    } catch (e: any) { setMsg({ t: 'No pude leer el archivo: ' + e.message }) }
  }
  const guardar = async () => {
    setBusy(true)
    try {
      const nuevas = prev.filter(p => p.factura.folio)
      for (const p of nuevas) {
        const { error: e1 } = await supabase.from('facturas').upsert(p.factura, { onConflict: 'folio' })
        if (e1) throw e1
        const { error: e2 } = await supabase.from('factura_lineas').delete().eq('factura_folio', p.factura.folio)
        if (e2) throw e2
        await insertarEnLotes('factura_lineas', p.lineas.map(({ id, ...l }) => l))
      }
      setMsg({ t: `${nuevas.length} factura(s) guardadas.`, ok: true }); setPrev([]); cargar()
    } catch (e: any) { setMsg({ t: e.message }) }
    setBusy(false)
  }
  const estatus = async (folio: string, est: string, por?: string) => {
    const { error } = await supabase.from('facturas').update({ estatus: est, sustituida_por: por ?? null }).eq('folio', folio)
    if (error) setMsg({ t: error.message }); else cargar()
  }
  const refacts = posiblesRefacturas(lineas).filter(r => facts.find(f => f.folio === r.anterior)?.estatus === 'vigente' && facts.find(f => f.folio === r.nueva)?.estatus === 'vigente')

  return (
    <>
      <div className="card">
        <h2>Cargar facturas del arrendador</h2>
        <p className="mut">Sube los PDF (uno o varios) tal como los manda el arrendador; el sistema lee placa, periodo, días y tarifa de cada renglón. También acepta el Excel de desglose.</p>
        <input type="file" multiple accept=".pdf,.xlsx" onChange={e => e.target.files && leer(e.target.files)} />
        {prev.map(p => (
          <div key={p.factura.folio} style={{ marginTop: 10 }}>
            <b>{p.factura.folio}</b> · {p.factura.fecha} · {p.lineas.length} conceptos · subtotal {fmt(p.factura.subtotal)}
            {folioExiste(facts, p.factura.folio) && <span className="pill warn"> ya existe: se reemplazará</span>}
            {p.avisos.map((a, i) => <div key={i} className="alert">{a}</div>)}
          </div>
        ))}
        {prev.length > 0 && <div style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar facturas'}</button></div>}
        {msg && <div className={`alert ${msg.ok ? 'okk' : 'err'}`}>{msg.t}</div>}
      </div>

      {refacts.map(r => (
        <div key={r.nueva} className="alert">
          <b>{r.nueva}</b> parece una re-facturación de <b>{r.anterior}</b> ({r.comunes} conceptos iguales). Si es así, marca la anterior como sustituida para no contar todo doble.{' '}
          <button className="link" onClick={() => estatus(r.anterior, 'sustituida', r.nueva)}>Marcar {r.anterior} como sustituida</button>
        </div>
      ))}

      <div className="card">
        <h2>Facturas cargadas</h2>
        <table><thead><tr><th>Folio</th><th>Fecha</th><th className="n">Conceptos</th><th className="n">Subtotal</th><th className="n">Total</th><th>Estatus</th></tr></thead>
          <tbody>{facts.map(f => (
            <tr key={f.folio}><td><b>{f.folio}</b></td><td>{f.fecha}</td><td className="n">{lineas.filter(l => l.factura_folio === f.folio).length}</td>
              <td className="n">{fmt(f.subtotal)}</td><td className="n">{fmt(f.total)}</td>
              <td><select style={{ width: 'auto' }} value={f.estatus} onChange={e => estatus(f.folio, e.target.value, e.target.value === 'vigente' ? undefined : f.sustituida_por ?? undefined)}>
                <option value="vigente">Vigente</option><option value="sustituida">Sustituida (re-facturada)</option><option value="cancelada">Cancelada</option></select>
                {f.sustituida_por && <span className="mut"> → {f.sustituida_por}</span>}</td></tr>
          ))}</tbody></table>
      </div>
    </>
  )
}
const folioExiste = (fs: { folio: string }[], f: string) => fs.some(x => x.folio === f)
