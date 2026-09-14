import type { FilaTabla } from './rapido-state'

/** La tabla de posiciones. Sin `<table>`: son filas flex, así nunca hace falta scroll horizontal en el teléfono. */
export function Tabla({ filas }: { filas: FilaTabla[] }) {
  if (filas.length === 0) return null

  return (
    <div className="overflow-hidden rounded-[14px] border border-line">
      {filas.map((fila, index) => (
        <div
          key={fila.clave}
          className={`flex items-center gap-2 px-3 py-2.5 ${index > 0 ? 'border-t border-line' : ''}`}
        >
          <span className="w-6 shrink-0 text-center text-[13px] font-extrabold text-muted">
            {fila.posicion}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold">
            {fila.jugadores.join(' y ')}
          </span>
          <span className="shrink-0 text-[12px] font-semibold text-muted">{fila.jugados}pj</span>
          <span className="w-9 shrink-0 text-right text-[13px] font-extrabold text-up">
            {fila.ganados}pg
          </span>
          <span
            className={`w-10 shrink-0 text-right text-[13px] font-extrabold ${
              fila.diferencia >= 0 ? 'text-up' : 'text-down'
            }`}
          >
            {fila.diferencia >= 0 ? `+${fila.diferencia}` : fila.diferencia}
          </span>
        </div>
      ))}
    </div>
  )
}
