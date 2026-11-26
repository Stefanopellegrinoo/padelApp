import { disciplineSlugs, sportFamily, type DisciplineId } from '@/core'
import type { SharedMatch } from '@/db/friends'
import type { MatchdaySummary, SeasonHeader } from '@/db/read'
import { matchdayDay, matchdayFull } from '@/app/format'

/**
 * Lo que decide Inicio sin dibujar: cuál es la fecha del bloque de arriba,
 * qué fechas ofrece "Cargar partido", y cómo se lee el último resultado con
 * un amigo. Puro, con test propio (`estado.unit.test.ts`).
 */

/** Una fecha sin cerrar de uno de tus torneos, con todo lo que hace falta para nombrarla y linkearla. */
export interface FechaViva {
  id: string
  seasonId: string
  seasonName: string
  disciplineId: DisciplineId
  /** El slug de URL de su deporte (`disciplineSlugs`), el mismo que arma la ruta de la fecha. */
  slug: string
  /** El `kind` de la disciplina: va a `data-deporte`. */
  sport: string
  number: number
  kind: 'REGULAR' | 'MASTERS'
  status: 'DRAFT' | 'OPEN'
  playedOn: string | null
  /**
   * Quien organiza, o cualquiera si el torneo lo permite
   * (`players_can_score`): la misma regla que dibuja la carga en la fecha
   * (`fechas/[n]/page.tsx`). La que manda de verdad es `match_sets_write`.
   */
  puedeCargar: boolean
}

/** Las fechas sin cerrar de un torneo, de todos sus deportes. */
export function fechasVivas(header: SeasonHeader, matchdays: readonly MatchdaySummary[]): FechaViva[] {
  const slugs = disciplineSlugs(header.disciplines)
  const kindOf = new Map(header.disciplines.map((d) => [d.id as string, d.kind]))
  return matchdays.flatMap((matchday) =>
    matchday.status === 'CLOSED'
      ? []
      : [
          {
            id: matchday.id,
            seasonId: header.id,
            seasonName: header.name,
            disciplineId: matchday.disciplineId,
            slug: slugs.get(matchday.disciplineId) ?? '',
            sport: kindOf.get(matchday.disciplineId) ?? '',
            number: matchday.number,
            kind: matchday.kind,
            status: matchday.status,
            playedOn: matchday.playedOn,
            puedeCargar: header.isAdmin || header.playersCanScore,
          },
        ],
  )
}

/** Días entre dos `YYYY-MM-DD`, sin signo. Sin día cargado, infinito: va al final. */
function distancia(hoy: string, playedOn: string | null): number {
  if (playedOn === null) return Number.POSITIVE_INFINITY
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)
  }
  return Math.abs(utc(playedOn) - utc(hoy)) / 86_400_000
}

function porCercania(hoy: string) {
  return (a: FechaViva, b: FechaViva) => {
    const d = distancia(hoy, a.playedOn) - distancia(hoy, b.playedOn)
    if (d !== 0 && !Number.isNaN(d)) return d
    // A la misma distancia, la que se está jugando: es la que tiene algo para hacer ya.
    return (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1)
  }
}

/**
 * La fecha del bloque de arriba: la más cercana a hoy, para adelante o para
 * atrás. "La próxima" a secas premiaría una fecha que quedó abierta hace
 * meses sobre la del martes que viene; la cercanía pone primero la que se
 * está jugando o se está por jugar.
 */
export function proximaFecha(fechas: readonly FechaViva[], hoy: string): FechaViva | null {
  return [...fechas].sort(porCercania(hoy))[0] ?? null
}

/** Las fechas que ofrece "Cargar partido": en juego y donde podés cargar. */
export function paraCargar(fechas: readonly FechaViva[], hoy: string): FechaViva[] {
  return fechas.filter((f) => f.status === 'OPEN' && f.puedeCargar).sort(porCercania(hoy))
}

/** Los torneos con su fecha más cercana primero; los que no tienen ninguna viva quedan en su orden. */
export function ordenarPorCercania<T extends { proxima: FechaViva | null }>(cards: readonly T[], hoy: string): T[] {
  return [...cards].sort((a, b) => {
    if (a.proxima === null || b.proxima === null) return (a.proxima === null ? 1 : 0) - (b.proxima === null ? 1 : 0)
    return porCercania(hoy)(a.proxima, b.proxima)
  })
}

/**
 * Cuántos torneos muestra "Tus torneos" sin abrir la grilla: dos filas, de dos
 * en el teléfono y de tres en pantalla ancha. Así "Amigos" sigue entrando en
 * la pantalla (S4) y el botón dice cuántos hay detrás.
 */
export const TORNEOS_A_LA_VISTA = { telefono: 4, ancho: 6 } as const

/** Cuándo se ve un bloque con la grilla plegada: siempre, sólo en pantalla ancha, o sólo abierta. */
export type VistaTorneo = 'siempre' | 'ancho' | 'abierta'

/**
 * Qué bloques se ven con la grilla plegada, en el orden en que llegan (el más
 * cercano a jugarse primero, `ordenarPorCercania`), y en qué anchos hace
 * falta el botón para ver el resto: con cinco o seis, sólo en el teléfono.
 */
export function torneosALaVista(total: number): { vistas: VistaTorneo[]; boton: 'nunca' | 'telefono' | 'siempre' } {
  const { telefono, ancho } = TORNEOS_A_LA_VISTA
  return {
    vistas: Array.from({ length: total }, (_, i) => (i < telefono ? 'siempre' : i < ancho ? 'ancho' : 'abierta')),
    boton: total <= telefono ? 'nunca' : total <= ancho ? 'telefono' : 'siempre',
  }
}

export function verTorneosTexto(total: number, abierta: boolean): string {
  return abierta ? 'Ver menos' : `Ver los ${total} torneos`
}

export function hrefFecha(fecha: Pick<FechaViva, 'seasonId' | 'slug' | 'number'>): string {
  return `/torneo/${fecha.seasonId}/${fecha.slug}/fechas/${fecha.number}`
}

export function tituloFecha(fecha: Pick<FechaViva, 'kind' | 'number'>): string {
  return fecha.kind === 'MASTERS' ? 'Masters' : `Fecha ${fecha.number}`
}

/** `"Miércoles 18 nov"`: el día de la fecha en el bloque, o `null` si no se cargó. */
export function diaFecha(playedOn: string | null): string | null {
  if (playedOn === null) return null
  const dia = matchdayFull(playedOn)
  return dia.charAt(0).toLocaleUpperCase('es') + dia.slice(1)
}

export function faltanTexto(n: number): string {
  if (n === 0) return 'Todos cargados'
  return n === 1 ? 'Falta 1 partido' : `Faltan ${n} partidos`
}

/**
 * Por dónde va el torneo, con el mismo número que la Tabla (`subtitleOf`):
 * la fecha en juego de la disciplina principal, que con todas cerradas no
 * pasa del total. El Masters no es una fecha del campeonato.
 */
export function progresoDe(header: SeasonHeader, matchdays: readonly MatchdaySummary[]): string {
  if (header.status === 'FINISHED') return 'Terminado'
  if (header.status === 'SETUP') return 'Sin empezar'
  const principal = header.disciplines[0]?.id
  const total = header.disciplines[0]?.config.regularMatchdays ?? header.regularMatchdays
  const cerradas = matchdays.filter(
    (m) => m.disciplineId === principal && m.kind === 'REGULAR' && m.status === 'CLOSED',
  ).length
  return `Fecha ${Math.min(cerradas + 1, total)} de ${total}`
}

const VERBOS_JUNTOS = { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' } as const
const VERBOS_CONTRA = { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataste' } as const

/** Una partida de ajedrez se anota 1-0, 0-1 o ½-½ (S3): sale del resultado, no de un marcador. */
export const PARTIDA_ANOTADA = { won: '1-0', lost: '0-1', drew: '½-½' } as const

/**
 * El último partido con un amigo, en pedazos para la fila: el verbo (de
 * compañeros es de la pareja, enfrentados es tuyo, como `leyendaDe` en
 * `app/amigos/historial.tsx`), el marcador y el día. Sólo para partidos con
 * resultado: es lo que `resumenAmigo` (`db/inicio.ts`) elige como último. En
 * ajedrez, como en el historial, el empate son tablas.
 */
export function ultimoResultado(partido: SharedMatch): {
  verbo: string
  marcador: string | null
  dia: string | null
  gano: boolean
} {
  const outcome = partido.outcome ?? 'drew'
  const esPartida = sportFamily(partido.sport) === 'result'
  const verbo = esPartida && outcome === 'drew' ? 'Tablas' : (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[outcome]
  const sets = partido.kind === 'casual' ? partido.sets : null
  const marcador = esPartida
    ? PARTIDA_ANOTADA[outcome]
    : sets !== null && sets.length > 0
      ? sets.map((set) => `${set.mine}-${set.theirs}`).join(' ')
      : partido.score !== null
        ? `${partido.score.mine}-${partido.score.theirs}`
        : null
  return {
    verbo,
    marcador,
    dia: partido.playedOn === null ? null : matchdayDay(partido.playedOn),
    gano: outcome === 'won',
  }
}
