export type Rol = 'dispatcher' | 'conciliacion' | 'master'

export interface Profile { id: string; nombre: string; rol: Rol; plaza: string | null; email?: string | null; activo?: boolean }

export interface Unidad {
  placa: string; plaza: string | null; tipo: string | null; vehiculo: string | null
  serie: string | null; operador: string | null; fecha_entrega: string | null; activa: boolean
}

export type TipoIncidencia = 'taller' | 'falla' | 'llantas' | 'sin_operador' | 'siniestro' | 'cambio_plaza' | 'otro'
export const TIPOS_INCIDENCIA: { v: TipoIncidencia; l: string }[] = [
  { v: 'taller', l: 'Pase a taller / mantenimiento' },
  { v: 'falla', l: 'Falla mecánica' },
  { v: 'llantas', l: 'Cambio / falta de llantas' },
  { v: 'siniestro', l: 'Siniestro / choque' },
  { v: 'sin_operador', l: 'Sin operador (no imputable al arrendador)' },
  { v: 'cambio_plaza', l: 'Cambio de plaza (traslado)' },
  { v: 'otro', l: 'Otro' },
]
/** Por defecto, estos tipos son responsabilidad del arrendador y descuentan renta. */
export const DESCUENTA_POR_DEFECTO: Record<TipoIncidencia, boolean> = {
  taller: true, falla: true, llantas: true, siniestro: true, sin_operador: false, cambio_plaza: false, otro: false,
}

export interface Incidencia {
  id: string; placa: string; tipo: TipoIncidencia; fecha_inicio: string; fecha_fin: string | null
  descuenta: boolean; plaza: string | null; plaza_destino: string | null; notas: string | null
  creado_por?: string; creado_en?: string
}

export interface Factura {
  id?: string; folio: string; fecha: string | null; proveedor: string | null
  subtotal: number; iva: number; total: number; folio_fiscal: string | null
}

export interface FacturaLinea {
  id?: string; factura_folio: string; factura_fecha: string | null; linea: number
  placa: string; serie: string | null; vehiculo: string | null; plaza: string | null
  inicio: string; fin: string; dias: number; tarifa: number; subtotal: number
  inicio_explicito: boolean
}

export interface Ruta { fecha: string; placa: string; id_ruta: string; transportista?: string | null; despachados?: number | null; entregados?: number | null }

/** Reporte de capacidad de Mercado Libre (informativo). */
export interface Capacidad {
  placa: string; actualizado: string; service_center?: string | null; vehiculo?: string | null; transportista?: string | null; id_ruta?: string | null
  solicitado: boolean; confirmado: boolean; asignado: boolean; escaneado: boolean; ejecutado: boolean
}

/** Prefactura de pago de Mercado Libre (ingreso del transportista). */
export interface PrefacturaML {
  id_prefactura: string; tipo: string; subtipo?: string | null; periodo: string; total: number; estado?: string | null
  ultima_modificacion?: string | null; nro_comprobante?: string | null; fecha_carga?: string | null
  subtotal?: number | null; total_con_iva?: number | null; id_sap?: string | null
}
