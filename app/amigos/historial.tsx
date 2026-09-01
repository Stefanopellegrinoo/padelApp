import type { SharedMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'

export interface HistorialProps {
  nombre: string
  partidos: readonly SharedMatch[]
}

type Resultado = NonNullable<SharedMatch['outcome']>

// De compañeros el resultado es el de LA PAREJA ("ganaron"); enfrentados es
// el TUYO contra él ("ganaste") -- diseño §4.4, y es lo que separa un
// partido de dobles de uno 1v1 sin necesitar un campo aparte.
const VERBOS_JUNTOS: Record<Resultado, string> = { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' }
const VERBOS_CONTRA: Record<Resultado, string> = { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataron' }

/**
 * Orden cronológico descendente. `playedOn` es nullable (una fecha sin jugar
 * todavía, diseño §4.4), así que un orden que sólo mirara ese campo sería
 * inestable -- acá el desempate es `matchdayNumber` descendente, que sí es
 * total, y las fechas sin jugar quedan siempre al final.
 */
function compararDescendente(a: SharedMatch, b: SharedMatch): number {
  if (a.playedOn !== b.playedOn) {
    if (a.playedOn === null) return 1
    if (b.playedOn === null) return -1
    return a.playedOn < b.playedOn ? 1 : -1
  }
  return b.matchdayNumber - a.matchdayNumber
}

// Reusa `matchdayDay` (`app/format.ts`), la misma fecha que ya se lee en
// Fechas, la tarjeta de próxima fecha y Mis torneos -- no hay motivo para que
// el historial invente un cuarto formato de fecha en la app.
function fechaDe(partido: SharedMatch): string {
  return partido.playedOn !== null ? matchdayDay(partido.playedOn) : `Fecha ${partido.matchdayNumber}`
}

// El copy dice el hecho ("Juntos: Ganaron 6-3"), nunca la forma cruda del
// dato ("outcome: won") -- es para quien juega, no para quien programa.
function resultadoDe(partido: SharedMatch): string {
  const quien = partido.together ? 'Juntos' : 'En contra'
  if (partido.outcome === null) return `${quien}: todavía sin resultado`
  const verbo = (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[partido.outcome]
  const marcador = partido.score !== null ? ` ${partido.score.mine}-${partido.score.theirs}` : ''
  return `${quien}: ${verbo}${marcador}`
}

/**
 * El historial de torneo con un amigo, sin leer nada -- recibe `SharedMatch[]`
 * por props. Mismo reparto que `rules-body.tsx`: la página lee, esto dibuja.
 *
 * Una lista, no dos contadores (diseño §4.4: *"un historial para acordarte
 * bien de cada partido que jugaste"*). Cada fila trae su fecha, su torneo, si
 * fue de compañeros o enfrentados, y cómo salió -- `historyWith` (Task 2) ya
 * trae ese detalle por partido, así que agregarlo de nuevo en un número sería
 * tirar la mitad del dato que se acaba de pagar por leer.
 */
export function Historial({ nombre, partidos }: HistorialProps) {
  const ordenados = [...partidos].sort(compararDescendente)

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">{nombre}</h1>

      {ordenados.length === 0 ? (
        // Estado vacío: dice qué falta, no dibuja una tabla sin filas.
        <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
          Todavía no jugaron ningún partido juntos.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {ordenados.map((partido) => (
            <div
              key={partido.matchId}
              className="flex flex-col gap-1 rounded-field border-[1.5px] border-line p-[14px]"
            >
              <p className="text-[13.5px] font-[550] text-muted">
                {fechaDe(partido)} · torneo {partido.seasonName}
              </p>
              <p className="text-[15px] font-extrabold tracking-[-.02em]">{resultadoDe(partido)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
