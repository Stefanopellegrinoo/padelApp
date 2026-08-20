import Link from 'next/link'
import { computeGlobalRanking, computeRanking, type DisciplineRanking } from '@/core'
import type { Client } from '@/db/client'
import {
  myEntryId,
  mySeasons,
  playerNames,
  seasonAwardsOf,
  seasonMatchdaysOf,
  seasonSquadOf,
  type SeasonHeader,
} from '@/db/read'
import { serverClient } from '@/db/server'
import { matchdayDay } from '../format'
import { Cuenta } from './cuenta'

/**
 * El chip de estado. El handoff (§5) dibuja el chip con su tipografía y su
 * color pero nunca le pone texto, y `ui-screens.md` §5 sólo nombra dos de los
 * tres casos ("en curso / terminado"). Los tres strings los decide el Plan 4.
 *
 * `SETUP` existe de verdad: una temporada recién creada no pasa a `ACTIVE`
 * hasta que se abre su primera fecha (0005_matchday_moves.sql).
 */
const ESTADO: Record<string, string> = {
  SETUP: 'Sin empezar',
  ACTIVE: 'En curso',
  FINISHED: 'Terminado',
}

interface SeasonCard {
  id: string
  name: string
  status: string
  estado: string
  /** `null` cuando la temporada todavía no repartió un punto: no hay posición que mostrar. */
  position: number | null
  squadSize: number
  /** El día de la próxima fecha, o `null` si no hay ninguna sin cerrar. */
  nextMatchday: string | null
}

/**
 * Se compone acá y no en `db/read.ts` a propósito (Plan 3: una función de
 * datos con forma de pantalla es la que después le falta algo).
 *
 * "Mi posición" es la de la TABLA GLOBAL (REQ-D9-1/2): suma, por persona, los
 * puntos de cada disciplina × su `weight` — con una sola disciplina y
 * `weight=1` (el caso de hoy) da lo mismo que antes. Por eso lee
 * `seasonSquadOf`/`seasonAwardsOf` (temporada entera) y no `entriesOf`/
 * `awardsOf` (una disciplina puntual): la global necesita el plantel y los
 * premios de CADA disciplina para sumarlos ponderados.
 *
 * ponytail: sin criterio de desempate propio — `computeRanking` corre con
 * snapshot vacío, sólo importa `.points`, nunca el orden. Alcanza mientras
 * nadie necesite ver POR QUÉ empatan dos personas en la global.
 *
 * Consultas por temporada, REMEDIDAS con `pg_stat_statements` (misma técnica
 * que S10) contra un escenario con una fecha cerrada
 * real: **10 antes** (S10 midió 9 sin ninguna CLOSED — `awardsOf` corta antes
 * de su 3ª consulta cuando no hay ninguna) → **5 después**. Sin fan-out por
 * disciplina: las dos lecturas de temporada entera traen TODAS en una sola
 * consulta cada una — mejora, y no crece con la cantidad de disciplinas.
 */
async function cardFor(supabase: Client, header: SeasonHeader): Promise<SeasonCard> {
  const [squad, matchdays, viewerEntryId] = await Promise.all([
    seasonSquadOf(supabase, header.id),
    seasonMatchdaysOf(supabase, header.id),
    myEntryId(supabase, header.id),
  ])
  const seasonAwards = await seasonAwardsOf(supabase, matchdays)

  const perDiscipline: DisciplineRanking[] = header.disciplines.map((discipline) => ({
    weight: discipline.weight,
    ranking: computeRanking(seasonAwards.get(discipline.id) ?? new Map(), squad, discipline.config, []),
  }))
  const ranking = computeGlobalRanking(perDiscipline)

  // Antes de que cierre la primera fecha de CUALQUIER disciplina, todos están
  // en cero: mismo criterio que la Tabla de una disciplina — no mostrar un
  // "1°" que no dice nada todavía.
  const anyClosed = matchdays.some(
    (matchday) => matchday.kind === 'REGULAR' && matchday.status === 'CLOSED',
  )
  const index = ranking.findIndex((row) => row.entryId === viewerEntryId)

  // "Próxima fecha" queda igual que antes (de la disciplina primaria): con
  // más de una disciplina puede haber más de una fecha viva a la vez
  //(REQ-D3-1) y elegir CUÁL mostrar acá es una decisión de UI que REQ-D9 no
  // pide — fuera del corte de esta PR.
  const primaryDisciplineId = header.disciplines[0]?.id
  const live =
    matchdays.find(
      (matchday) => matchday.disciplineId === primaryDisciplineId && matchday.status !== 'CLOSED',
    ) ?? null

  return {
    id: header.id,
    name: header.name,
    status: header.status,
    estado: ESTADO[header.status] ?? '',
    position: !anyClosed || index < 0 ? null : index + 1,
    squadSize: squad.length,
    nextMatchday: live?.playedOn ?? null,
  }
}

function CrearTorneo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/torneos/nuevo"
      className={`rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text ${className}`}
    >
      Crear torneo
    </Link>
  )
}

/**
 * Mis torneos — §5 del handoff. Es la pantalla de entrada a la app, y va **sin
 * bottom nav**: está un nivel por encima del torneo.
 */
export default async function MisTorneosPage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const headers = await mySeasons(supabase)
  const [cards, myName] = await Promise.all([
    Promise.all(headers.map((header) => cardFor(supabase, header))),
    (async () => {
      const { data: playerId } = await supabase.rpc('my_player_id')
      if (playerId === null) return ''
      return (await playerNames(supabase, [playerId])).get(playerId) ?? ''
    })(),
  ])

  const live = cards.filter((card) => card.status !== 'FINISHED')
  const finished = cards.filter((card) => card.status === 'FINISHED')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-3 bg-bg px-5 pb-6 text-text">
      {/* El nombre dejó de ser un kicker y pasó a estar adentro del círculo:
          era texto que no hacía nada, y ahora es el único acceso a la cuenta. */}
      <header className="flex items-center justify-between gap-3 pt-4">
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Mis torneos</h1>
        <Cuenta name={myName} />
      </header>

      {cards.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <h2 className="text-pretty text-[22px] font-extrabold tracking-[-.02em]">
            Todavía no estás en ningún torneo
          </h2>
          <p className="text-pretty text-[14px] font-[550] leading-[1.5] text-muted">
            Creá el tuyo y compartí el link con el grupo. Si alguien ya te pasó un link de
            invitación, abrilo y elegí tu nombre de la lista.
          </p>
          <CrearTorneo className="mt-2" />
          {user === null && (
            <Link href="/login" className="text-center text-[12.5px] font-bold text-accent-link">
              Entrar
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {live.map((card) => (
              <Link
                key={card.id}
                href={`/torneo/${card.id}`}
                className="block rounded-card border border-line bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[18px] font-extrabold tracking-[-.02em]">{card.name}</p>
                  <span className="shrink-0 rounded-full bg-ok-bg px-[10px] py-[6px] text-[10.5px] font-extrabold text-up">
                    {card.estado}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-4">
                  <div className="flex flex-col gap-[2px]">
                    <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
                      Mi posición
                    </p>
                    <p className="text-[15px] font-extrabold">
                      {card.position === null ? '—' : `${card.position}°`}
                    </p>
                  </div>
                  <span className="h-[26px] w-px shrink-0 bg-line" />
                  <div className="flex flex-col gap-[2px]">
                    <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
                      Próxima fecha
                    </p>
                    <p className="text-[15px] font-extrabold">
                      {card.nextMatchday === null ? '—' : matchdayDay(card.nextMatchday)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <CrearTorneo className="mt-1" />

          {finished.length > 0 && (
            <>
              <div className="mt-3 flex items-center gap-3">
                <p className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
                  Terminados
                </p>
                <span className="h-px flex-1 bg-line" />
              </div>
              {finished.map((card) => (
                <Link
                  key={card.id}
                  href={`/torneo/${card.id}`}
                  className="flex items-center justify-between gap-3 py-2 opacity-60"
                >
                  <div>
                    <p className="text-[15px] font-[750]">{card.name}</p>
                    <p className="text-[12px] font-semibold text-muted">{card.estado}</p>
                  </div>
                  <p className="shrink-0 text-[15px] font-extrabold">
                    {card.position === null ? '—' : `${card.position}°`}
                  </p>
                </Link>
              ))}
            </>
          )}
        </>
      )}
    </main>
  )
}
