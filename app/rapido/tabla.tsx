import type { FilaTabla } from './rapido-state'

const COLS = 'grid-cols-[36px_minmax(0,1fr)_36px_40px_52px]'

/**
 * La tabla de posiciones, con la cara de la Tabla del torneo: el puesto y los
 * ganados en la cara condensada, jugados y diferencia al costado. Sin
 * `<table>`: filas en grilla de 390 px, sin scroll horizontal.
 *
 * Antes del primer resultado no hay puestos: todos están en 0 y un "1" diría
 * un orden que no existe (va una raya). Después, el puesto 1 va en el color
 * del deporte en cuanto alguien ganó algo. El amarillo no: acá no hay "vos".
 * El encabezado es mudo; cada número se lee con su nombre (`sr-only`).
 */
export function Tabla({ filas }: { filas: FilaTabla[] }) {
  if (filas.length === 0) return null
  const sinJugar = filas.every((fila) => fila.jugados === 0)

  return (
    <div>
      <div aria-hidden="true" className={`grid ${COLS} h-9 items-center gap-1 px-4 text-[13px] font-semibold text-muted`}>
        <span />
        <span />
        <span className="text-right">PJ</span>
        <span className="text-right">PG</span>
        <span className="text-right">Dif</span>
      </div>
      <ol>
        {filas.map((fila) => {
          const lidera = fila.posicion === 1 && fila.ganados > 0
          return (
            <li
              key={fila.clave}
              data-fila-tabla=""
              className={`grid ${COLS} min-h-[48px] items-center gap-1 border-t border-line px-4`}
            >
              {sinJugar ? (
                <span aria-hidden="true" className="text-[20px] font-bold text-muted">
                  –
                </span>
              ) : (
                <span className={`font-cond text-[26px] ${lidera ? 'text-sport' : ''}`}>
                  {fila.posicion}
                  <span className="sr-only">°</span>
                </span>
              )}
              <span className="min-w-0 py-1 text-[16px] leading-tight font-semibold [overflow-wrap:anywhere]">
                {fila.jugadores.join(' y ')}
              </span>
              <span className="text-right tabular-nums text-muted">
                {fila.jugados}
                <span className="sr-only"> jugados</span>
              </span>
              <span className="font-cond text-right text-[26px]">
                {fila.ganados}
                <span className="sr-only"> ganados</span>
              </span>
              <span className={`text-right text-[15px] font-bold tabular-nums ${
                  fila.diferencia > 0 ? 'text-up' : fila.diferencia < 0 ? 'text-down' : 'text-muted'
                }`}>
                {fila.diferencia > 0 ? `+${fila.diferencia}` : fila.diferencia}
                <span className="sr-only"> de diferencia</span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
