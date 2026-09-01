import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { CasualMatchRow } from './[playerId]/cargar'

export interface HistorialProps {
  nombre: string
  /**
   * El id del amigo de esta pantalla -- Task 4 lo necesita para Editar/Borrar
   * (`CasualMatchRow`, `[playerId]/cargar.tsx`): el formulario de edición
   * manda un `friendPlayerId` oculto, y borrar redirige a
   * `/amigos/{friendPlayerId}`, no a la lista. No hace falta para las filas
   * de torneo, pero `HistorialProps` es una sola interfaz para las dos clases.
   */
  friendPlayerId: string
  /**
   * Ya viene en el orden en que se tiene que dibujar -- `historyWith`
   * (`db/friends.ts`) mezcla torneo y casual y ordena por fecha descendente
   * entre las dos fuentes (`porFechaDescendente`, ahí). Este componente NO
   * vuelve a ordenar: dos comparadores sobre la misma regla es la forma en
   * que un día divergen y dos pantallas terminan en desacuerdo sobre el
   * mismo historial.
   */
  partidos: readonly SharedMatch[]
}

type Resultado = NonNullable<TournamentMatch['outcome']>

// De compañeros el resultado es el de LA PAREJA ("ganaron"); enfrentados es
// el TUYO contra él ("ganaste") -- diseño §4.4, y es lo que separa un
// partido de dobles de uno 1v1 sin necesitar un campo aparte.
const VERBOS_JUNTOS: Record<Resultado, string> = { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' }
const VERBOS_CONTRA: Record<Resultado, string> = { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataste' }

// Un partido casual es SIEMPRE "en contra" -- son dos personas, nunca dobles
// (diseño §7) -- así que reusa el mismo verbo en primera persona que el
// torneo enfrentado, sin el prefijo "En contra:" que ahí distingue del caso
// de compañeros: acá ese caso no existe y no hay campo `together` que lo diga.
const VERBOS_CASUAL = VERBOS_CONTRA

// Reusa `matchdayDay` (`app/format.ts`), la misma fecha que ya se lee en
// Fechas, la tarjeta de próxima fecha y Mis torneos -- no hay motivo para que
// el historial invente un cuarto formato de fecha en la app.
function fechaDe(partido: TournamentMatch): string {
  return partido.playedOn !== null ? matchdayDay(partido.playedOn) : `Fecha ${partido.matchdayNumber}`
}

// El copy dice el hecho ("Juntos: Ganaron 6-3"), nunca la forma cruda del
// dato ("outcome: won") -- es para quien juega, no para quien programa.
function resultadoDe(partido: TournamentMatch): string {
  const quien = partido.together ? 'Juntos' : 'En contra'
  if (partido.outcome === null) return `${quien}: todavía sin resultado`
  const verbo = (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[partido.outcome]
  const marcador = partido.score !== null ? ` ${partido.score.mine}-${partido.score.theirs}` : ''
  return `${quien}: ${verbo}${marcador}`
}

/**
 * El resultado de un partido casual, en primera persona. §4.3 manda mostrar
 * el HECHO, no la interpretación: `winner` es un dato propio que no se
 * deduce del marcador (un 2-2 puede cerrar empatado o resolverse aparte --
 * por penales en FIFA, pero la app no sabe que "FIFA" es fútbol y no lo
 * nombra). Cuando el marcador queda empatado y sin embargo hay un ganador
 * (`outcome !== 'drew'`), decir "Ganaste 2-2" o "Perdiste 2-2" leería como un
 * error de tipeo -- se nombra al ganador en cambio, como en el ejemplo del
 * diseño: "2-2 · ganó Juan".
 */
function resultadoCasualDe(partido: CasualMatch, nombreAmigo: string): string {
  const marcador = partido.score !== null ? `${partido.score.mine}-${partido.score.theirs}` : ''
  const marcadorEmpatado = partido.score !== null && partido.score.mine === partido.score.theirs
  if (marcadorEmpatado && partido.outcome !== 'drew') {
    const ganador = partido.outcome === 'won' ? 'Ganaste' : `Ganó ${nombreAmigo}`
    return `${marcador} · ${ganador}`
  }
  const verbo = VERBOS_CASUAL[partido.outcome]
  return marcador !== '' ? `${verbo} ${marcador}` : verbo
}

// El equipo con el que jugaste VOS -- el ejemplo del diseño (§4.4) sólo
// muestra ese lado ("jugaste con Boca"); el del amigo se guarda
// (`CasualMatch.teams.theirs`) pero no hace falta para leer el partido en tu
// propio historial.
function equipoDe(partido: CasualMatch): string | null {
  return partido.teams.mine !== null ? `jugaste con ${partido.teams.mine}` : null
}

// §3.2: dos datos y una línea, no un log de auditoría ni un historial de
// versiones -- eso sí sería sobreconstruir, dice el diseño con esas palabras.
// Si cargó y editó la misma persona, se dice una sola vez: dos líneas iguales
// apiladas es ruido, no información.
//
// La comparación es por ID (`createdById`/`updatedById`), NUNCA por nombre --
// review final de 2b, Important 2: `display_name` es texto libre sin
// `unique` (`players`, 0001_schema.sql), así que dos amigos DISTINTOS pueden
// compartir nombre. Comparar `createdBy === updatedBy` (los nombres)
// colapsaba ese caso exactamente en el momento en que §3.2 existe para
// evitarlo: "Juan cargó, editó Juan" (dos Juanes distintos) leía como que
// nadie tocó nada.
function autoriaDe(partido: CasualMatch): string {
  if (partido.createdById === partido.updatedById) return `Cargó ${partido.createdBy}`
  return `Cargó ${partido.createdBy} · editó ${partido.updatedBy}`
}

/**
 * El historial (torneo + casual) con un amigo, sin leer nada -- recibe
 * `SharedMatch[]` ya mezclado y ordenado por props (`historyWith`, Task 2).
 * Mismo reparto que `rules-body.tsx`: la página lee, esto dibuja.
 *
 * Una lista, no dos contadores (diseño §4.4: *"un historial para acordarte
 * bien de cada partido que jugaste"*). Cada fila trae su propio detalle --
 * `historyWith` ya lo entrega por partido, así que agregarlo de nuevo en un
 * número sería tirar la mitad del dato que se acaba de pagar por leer.
 */
export function Historial({ nombre, friendPlayerId, partidos }: HistorialProps) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">{nombre}</h1>

      {partidos.length === 0 ? (
        // Estado vacío: dice qué falta, no dibuja una tabla sin filas.
        <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
          Todavía no jugaron ningún partido juntos.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {partidos.map((partido) => {
            if (partido.kind === 'tournament') {
              return (
                <div
                  key={partido.matchId}
                  className="flex flex-col gap-1 rounded-field border-[1.5px] border-line p-[14px]"
                >
                  <p className="text-[13.5px] font-[550] text-muted">
                    {fechaDe(partido)} · torneo {partido.seasonName}
                  </p>
                  <p className="text-[15px] font-extrabold tracking-[-.02em]">{resultadoDe(partido)}</p>
                </div>
              )
            }

            const equipo = equipoDe(partido)
            return (
              <CasualMatchRow
                key={partido.matchId}
                friendPlayerId={friendPlayerId}
                friendName={nombre}
                partido={partido}
              >
                <p className="text-[13.5px] font-[550] text-muted">
                  {matchdayDay(partido.playedOn)} · {partido.sport}
                </p>
                <p className="text-[15px] font-extrabold tracking-[-.02em]">
                  {resultadoCasualDe(partido, nombre)}
                  {equipo !== null ? `, ${equipo}` : ''}
                </p>
                <p className="text-[13.5px] font-[550] text-muted">{autoriaDe(partido)}</p>
              </CasualMatchRow>
            )
          })}
        </div>
      )}
    </div>
  )
}
