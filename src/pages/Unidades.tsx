import { useEffect, useState } from 'react'
import { fetchAll, insertarEnLotes, supabase } from '../supabase'
import { leerLibro, parseInventario } from '../lib/parseExcel'
import type { Unidad } from '../lib/types'

export default function Unidades() {
  const [lista, setLista] = useState<Unidad[]>([])
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null)
  const cargar = () => fetchAll<Unidad>('unidades', 'placa').then(setLista).catch(e => setMsg({ t: e.message }))
  useEffect(() => { cargar() }, [])

  const importar = async (file: File) => {
    try {
      const u = parseInventario(leerLibro(await file.arrayBuffer()))
      await insertarEnLotes('unidades', u, { onConflict: 'placa' })
      setMsg({ t: `${u.length} unidades importadas/actualizadas.`, ok: true }); cargar()
    } catch (e: any) { setMsg({ t: e.message }) }
  }
  const cambiar = async (placa: string, campo: Partial<Unidad>) => {
    const { error } = await supabase.from('unidades').update(campo).eq('placa', placa)
    if (error) setMsg({ t: error.message }); else cargar()
  }
  return (
    <div className="card">
      <h2>Inventario de unidades ({lista.length})</h2>
      <p className="mut">Sube el Excel del inventario (columnas: Placa, Localidad, Marca/vehículo, Tipo, Serie, Operador responsable, Fecha entrega). Si la placa ya existe se actualiza.</p>
      <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files?.[0] && importar(e.target.files[0])} />
      {msg && <div className={`alert ${msg.ok ? 'okk' : 'err'}`}>{msg.t}</div>}
      <div className="scroll"><table>
        <thead><tr><th>Placa</th><th>Plaza</th><th>Vehículo</th><th>Tipo</th><th>Serie</th><th>Operador</th><th>Entrega</th><th>Activa</th></tr></thead>
        <tbody>{lista.map(u => (
          <tr key={u.placa}><td><b>{u.placa}</b></td><td>{u.plaza}</td><td>{u.vehiculo}</td><td>{u.tipo}</td><td className="mut">{u.serie}</td><td>{u.operador}</td>
            <td><input type="date" defaultValue={u.fecha_entrega ?? ''} onBlur={e => e.target.value !== (u.fecha_entrega ?? '') && cambiar(u.placa, { fecha_entrega: e.target.value || null })} /></td>
            <td><input type="checkbox" style={{ width: 'auto' }} checked={u.activa} onChange={e => cambiar(u.placa, { activa: e.target.checked })} /></td></tr>
        ))}</tbody>
      </table></div>
    </div>
  )
}
