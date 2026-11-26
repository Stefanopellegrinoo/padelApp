import Link from 'next/link'
import {
  computeGlobalRanking,
  computeRanking,
  isUnplayedThirdPlace,
  sportLabel,
  type DisciplineRanking,
} from '@/core'
import type { Client } from '@/db/client'
import { amigosDeInicio, type AmigoInicio } from '@/db/inicio'
import {
  attendancesOf,
  entriesOf,
  matchdayDetail,
  myEntryId,
  mySeasons,
  playerNames,
  seasonAwardsOf,
  seasonMatchdaysOf,
  seasonSquadOf,
  type SeasonHeader,
} from '@/db/read'
import { serverClient } from '@/db/server'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { rowPress } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { Cuenta } from './cuenta'
import { CargarPartido } from './inicio/cargar-partido'
import {
  diaFecha,
  faltanTexto,
  fechasVivas,
  hrefFecha,
  ordenarPorCercania,
  paraCargar,
  progresoDe,
  proximaFecha,
  tituloFecha,
  ultimoResultado,
  type FechaViva,
} from './inicio/estado'
import { Icono, IconoDeporte } from './inicio/iconos'
import { TusTorneos } from './inicio/torneos'
import { matchdayDay } from '../format'

interface SeasonCard {
  id: string
  name: string
  status: string
  /** El `kind` de la disciplina principal: el color del bloque (`data-deporte`). */
  sport: string
  /** "Pádel", o "Pádel y FIFA" con más de un deporte. */
  sports: string
  /** "Fecha 8 de 12", "Sin empezar", "Terminado" (`progresoDe`). */
  progreso: string
  /** `null` cuando la temporada todavía no repartió un punto: no hay posición que mostrar. */
  position: number | null
  squadSize: number
  /** Las fechas sin cerrar de todos sus deportes. */
  fechas: FechaViva[]
}

/**
 * Se compone acá y no en `db/read.ts` a propósito (Plan 3: una función de
 * datos con forma de pantalla es la que después le falta algo).
 *
 * "Tu posición" es la de la TABLA GLOBAL (REQ-D9-1/2): suma, por persona, los
 * puntos de cada disciplina × su `weight` — con una sola disciplina y
 * `weight=1` da lo mismo que la tabla de esa disciplina. Por eso lee
 * `seasonSquadOf`/`seasonAwardsOf` (temporada entera) y no `entriesOf`/
 * `awardsOf` (una disciplina puntual).
 *
 * ponytail: sin criterio de desempate propio para el ORDEN de las filas —
 * `computeRanking` corre con snapshot vacío, y ese orden nunca se lee acá.
 * Lo que sí se lee es `position` de `computeGlobalRanking`
 * (docs/tipos-de-torneo.md §2.4): numeración de competencia, compartida
 * entre empatados.
 *
 * Cinco consultas por temporada (medidas con `pg_stat_statements`), sin
 * fan-out por disciplina. Las fechas vivas salen de las mismas
 * `seasonMatchdaysOf` que ya se traían: el bloque de arriba y "Cargar
 * partido" no suman consultas por torneo.
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
  // en cero: mismo criterio que la Tabla — no mostrar un "1°" que no dice
  // nada todavía.
  const anyClosed = matchdays.some((matchday) => matchday.kind === 'REGULAR' && matchday.status === 'CLOSED')
  const myRow = ranking.find((row) => row.entryId === viewerEntryId) ?? null

  return {
    id: header.id,
    name: header.name,
    status: header.status,
    sport: header.disciplines[0]?.kind ?? '',
    sports: [...new Set(header.disciplines.map((d) => sportLabel(d.kind)))].join(' y '),
    progreso: progresoDe(header, matchdays),
    // `row.position` de `computeGlobalRanking`, no un índice de array: con
    // los mismos puntos hay empate y el puesto se comparte (1, 2, 2, 4) —
    // docs/tipos-de-torneo.md §2.4.
    position: !anyClosed || myRow === null ? null : myRow.position,
    squadSize: squad.length,
    fechas: fechasVivas(header, matchdays),
  }
}

/**
 * Cómo viene la fecha del bloque de arriba, sólo con lo que la base sabe. En
 * juego: cuántos partidos faltan cargar, con la misma cuenta que el botón de
 * cerrar de la fecha (un tercer puesto sin jugar no cuenta,
 * `isUnplayedThirdPlace`). Armándose: cuántos del plantel están confirmados
 * — sin fila de asistencia es "viene", como en el armado (`fechas/[n]/page.tsx`)
 * — y que las parejas todavía no se sortearon, que es lo que dice `DRAFT`.
 */
type EstadoFecha =
  | { kind: 'OPEN'; faltan: number; cargados: number }
  | { kind: 'DRAFT'; confirmados: number; plantel: number }

async function estadoDe(supabase: Client, fecha: FechaViva): Promise<EstadoFecha> {
  if (fecha.status === 'OPEN') {
    const { matches } = await matchdayDetail(supabase, fecha.id)
    const faltan = matches.filter((m) => m.sets.length === 0 && !isUnplayedThirdPlace(m)).length
    return { kind: 'OPEN', faltan, cargados: matches.filter((m) => m.sets.length > 0).length }
  }
  const [entries, attendances] = await Promise.all([
    entriesOf(supabase, fecha.seasonId, fecha.disciplineId),
    attendancesOf(supabase, fecha.id),
  ])
  const plantel = entries.filter((entry) => entry.kind === 'SQUAD')
  return {
    kind: 'DRAFT',
    confirmados: plantel.filter((entry) => attendances.get(entry.id) !== 'ABSENT').length,
    plantel: plantel.length,
  }
}

/** Hoy en `YYYY-MM-DD`, con la fecha local del servidor (la de `played_on` no tiene hora). */
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Hasta cuántos amigos van en Inicio: el resto está en "Ver todos". */
const AMIGOS_EN_INICIO = 4

/** Hasta cuántos amigos van en la hoja "Cargar partido": el resto, en "Ver todos". */
const AMIGOS_EN_LA_HOJA = 6

/**
 * Inicio — la entrada de la app (estructura B, `design/inicio/02`, con el
 * lenguaje del prototipo): arriba, en el bloque, la fecha más cercana de tus
 * torneos; abajo, "Tus torneos" (una grilla de dos filas, `TusTorneos`) y
 * "Amigos", las dos partes de la app a la vista desde que la abrís (S4). "Cargar partido", fijo abajo, junta los
 * caminos más cortos para cargar un resultado.
 *
 * Sin barra de pestañas: está un nivel por encima del torneo. La cuenta
 * (amigos, privacidad, cerrar sesión) es el círculo de arriba a la derecha.
 */
export default async function InicioPage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const headers = await mySeasons(supabase)
  const hoy = hoyISO()
  const [cards, myName, amigos] = await Promise.all([
    Promise.all(headers.map((header) => cardFor(supabase, header))),
    (async () => {
      const { data: playerId } = await supabase.rpc('my_player_id')
      if (playerId === null) return ''
      return (await playerNames(supabase, [playerId])).get(playerId) ?? ''
    })(),
    user === null ? Promise.resolve([]) : amigosDeInicio(supabase),
  ])

  const live = ordenarPorCercania(
    cards
      .filter((card) => card.status !== 'FINISHED')
      .map((card) => ({ ...card, proxima: proximaFecha(card.fechas, hoy) })),
    hoy,
  )
  const finished = cards.filter((card) => card.status === 'FINISHED')
  const fechas = live.flatMap((card) => card.fechas)
  const proxima = proximaFecha(fechas, hoy)
  const estado = proxima === null ? null : await estadoDe(supabase, proxima)
  const cargables = paraCargar(fechas, hoy).map((fecha) => ({
    id: fecha.id,
    href: hrefFecha(fecha),
    titulo: tituloFecha(fecha),
    torneo: fecha.seasonName,
    dia: fecha.playedOn === null ? null : matchdayDay(fecha.playedOn),
    sport: fecha.sport,
  }))

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(104px+env(safe-area-inset-bottom))] text-text">
      <div className="relative">
        {proxima !== null && estado !== null ? (
          <HeroFecha fecha={proxima} estado={estado} />
        ) : cards.length === 0 ? (
          <HeroVacio entrar={user === null} />
        ) : (
          <Hero kicker={<span className="pr-14">Inicio</span>} title={<span className="block pr-12">Sin fechas en juego</span>} />
        )}
        <div className="absolute top-[calc(6px+env(safe-area-inset-top))] right-4 [--color-focus:var(--color-on-block)]">
          <Cuenta name={myName} />
        </div>
      </div>

      {cards.length === 0 ? (
        <Section title="Tus torneos">
          <p className="rounded-tile border-[1.5px] border-dashed border-line px-4 py-3.5 text-[15px] text-muted">
            ¿Te pasaron un link de invitación? Abrilo y elegí tu nombre.
          </p>
        </Section>
      ) : (
        <TusTorneos
          torneos={live.map(({ id, name, sport, sports, progreso, position, squadSize }) => ({
            id,
            name,
            sport,
            sports,
            progreso,
            position,
            squadSize,
          }))}
        >
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <Link href="/torneos/nuevo" className="press flex min-h-[48px] items-center gap-1.5 rounded-btn px-1 text-[16px] font-bold text-accent-link active:bg-sport-tint">
              <Icono name="plus" className="h-[18px] w-[18px]" />
              Crear torneo
            </Link>
            <Link href="/rapido" className="press flex min-h-[48px] items-center gap-1.5 rounded-btn px-1 text-[16px] font-bold text-accent-link active:bg-sport-tint">
              <Icono name="bolt" className="h-[18px] w-[18px]" />
              Torneo rápido
            </Link>
          </div>
        </TusTorneos>
      )}

      <Section
        title="Amigos"
        action={
          amigos.length > 0 ? (
            <Link href="/amigos" className="press -my-2 flex min-h-[44px] items-center px-1 text-[16px] font-bold text-accent-link">
              Ver todos
            </Link>
          ) : undefined
        }
      >
        <ul className="-mx-4">
          {amigos.length === 0 ? (
            <li>
              <Link href="/amigos" className={`${rowPress} min-h-[72px]`}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sport-tint text-sport">
                  <Icono name="plus" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold">Sumá un amigo</span>
                  <span className="block text-[14px] text-muted">El historial con cada uno</span>
                </span>
                <Icono name="chev" className="h-6 w-6 text-muted" />
              </Link>
            </li>
          ) : (
            amigos.slice(0, AMIGOS_EN_INICIO).map((amigo) => <FilaAmigo key={amigo.playerId} amigo={amigo} />)
          )}
        </ul>
      </Section>

      {finished.length > 0 && (
        <Section title="Terminados" className="pt-7">
          <ul className="-mx-4">
            {finished.map((card) => (
              <li key={card.id} data-deporte={card.sport}>
                <Link href={`/torneo/${card.id}`} className={rowPress}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[17px] font-bold">{card.name}</span>
                    <span className="block text-[14px] text-muted">{card.sports}</span>
                  </span>
                  {card.position !== null && (
                    <span className="shrink-0 text-right">
                      <span className="sr-only">Terminaste </span>
                      <span className="font-cond text-[30px] text-sport">
                        {card.position}
                        <span className="align-[.45em] text-[.5em]">°</span>
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Sin fechas para cargar ni amigos no hay partido que cargar: el botón
          competiría con "Crear torneo" sin llevar a ningún lado. */}
      {user !== null && (cargables.length > 0 || amigos.length > 0) && (
        <CargarPartido
          fechas={cargables}
          amigos={amigos
            .slice(0, AMIGOS_EN_LA_HOJA)
            .map((amigo) => ({ playerId: amigo.playerId, displayName: amigo.displayName }))}
        />
      )}
    </main>
  )
}

/** El bloque de la fecha más cercana: el torneo, "Fecha 8", el día, cómo viene y el link. */
function HeroFecha({ fecha, estado }: { fecha: FechaViva; estado: EstadoFecha }) {
  const dia = diaFecha(fecha.playedOn)
  const pips =
    estado.kind === 'OPEN'
      ? { llenos: estado.cargados, total: estado.cargados + estado.faltan }
      : { llenos: estado.confirmados, total: estado.plantel }
  return (
    <Hero
      sport={fecha.sport}
      kicker={
        <span className="flex min-w-0 items-center gap-2 pr-14">
          <IconoDeporte kind={fecha.sport} className="h-[18px] w-[18px]" />
          <span className="truncate">{fecha.seasonName}</span>
        </span>
      }
      title={tituloFecha(fecha)}
      titleVariant="number"
    >
      <p className="mt-2 text-[21px] font-bold font-stretch-[88%]">
        {dia ?? (fecha.status === 'OPEN' ? 'En juego' : 'Armándose')}
      </p>
      {dia !== null && (
        <p className="text-[16px] text-on-block-soft">{fecha.status === 'OPEN' ? 'En juego' : 'Armándose'}</p>
      )}
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {pips.total > 0 && pips.total <= 16 && (
            <span aria-hidden="true" className="mb-2 flex flex-wrap gap-1">
              {Array.from({ length: pips.total }, (_, i) => (
                <i
                  key={i}
                  className={`h-3 w-3 rounded-[3px] ${i < pips.llenos ? 'bg-on-block' : 'shadow-[inset_0_0_0_1.5px_var(--color-on-block-soft)]'}`}
                />
              ))}
            </span>
          )}
          {estado.kind === 'OPEN' ? (
            <p className="text-[15px] leading-snug">
              <b className="font-bold">{faltanTexto(estado.faltan)}</b>
              <span className="block text-on-block-soft">
                {estado.cargados} de {estado.cargados + estado.faltan} cargados
              </span>
            </p>
          ) : (
            <p className="text-[15px] leading-snug">
              <b className="font-bold">
                {estado.confirmados} de {estado.plantel}
              </b>{' '}
              confirmados
              <span className="block text-on-block-soft">Parejas sin sortear</span>
            </p>
          )}
        </div>
        <Link href={hrefFecha(fecha)} className={`${button('onBlock')} min-h-[48px] shrink-0 pr-3 pl-[18px]`}>
          Ver la fecha
          <Icono name="chev" className="h-[18px] w-[18px]" />
        </Link>
      </div>
    </Hero>
  )
}

/** Sin torneos: el bloque es la invitación a armar el primero. */
function HeroVacio({ entrar }: { entrar: boolean }) {
  return (
    <Hero
      kicker={<span className="pr-14">Inicio</span>}
      title={<span className="block pr-12">Armá el torneo del grupo</span>}
      subtitle="La tabla, las fechas y el historial con tus amigos."
    >
      <div className="mt-5 flex flex-col gap-2">
        <Link href="/torneos/nuevo" className={button('onBlock', { size: 'lg', full: true })}>
          <Icono name="plus" />
          Crear torneo
        </Link>
        <Link
          href="/rapido"
          className="press flex min-h-[48px] items-center justify-center gap-2 rounded-btn text-[16px] font-bold text-on-block active:bg-white/15"
        >
          <Icono name="bolt" className="h-[18px] w-[18px]" />
          Torneo rápido
        </Link>
        {entrar && (
          <Link href="/login" className="flex min-h-[44px] items-center justify-center text-[16px] font-bold text-on-block underline">
            Entrar
          </Link>
        )}
      </div>
    </Hero>
  )
}

/**
 * Un amigo: su último resultado (verbo, marcador y día) y el cara a cara. El
 * número es el de enfrentados, lo tuyo contra él; si sólo jugaron de
 * compañeros, el de la pareja, con "juntos" abajo para que no se confunda.
 */
function FilaAmigo({ amigo }: { amigo: AmigoInicio }) {
  const ultimo = amigo.ultimo === null ? null : ultimoResultado(amigo.ultimo)
  const enContra = amigo.contra.won + amigo.contra.lost + amigo.contra.drew > 0
  const deJuntos = amigo.juntos.won + amigo.juntos.lost + amigo.juntos.drew > 0
  const registro = enContra ? amigo.contra : deJuntos ? amigo.juntos : null
  const empates = registro !== null && registro.drew > 0 ? `, ${enContra ? 'empataste' : 'empataron'} ${registro.drew}` : ''
  const aria =
    registro === null
      ? undefined
      : enContra
        ? `Historial: ganaste ${registro.won}, perdiste ${registro.lost}${empates}`
        : `Juntos: ganaron ${registro.won}, perdieron ${registro.lost}${empates}`
  return (
    <li data-deporte={amigo.ultimo?.sport}>
      <Link href={`/amigos/${amigo.playerId}`} className={`${rowPress} min-h-[72px]`}>
        <Avatar name={amigo.displayName} />
        <span className="min-w-0 flex-1">
          {/* En 360, con el cara a cara al lado, baja a un segundo renglón antes que cortarse. */}
          <span className="line-clamp-2 block text-[17px] leading-tight font-bold break-words">{amigo.displayName}</span>
          <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug text-muted">
            {ultimo === null ? (
              'Sin partidos todavía'
            ) : (
              <>
                <span className={ultimo.gano ? 'font-semibold text-up' : 'font-semibold text-text'}>
                  {ultimo.verbo}
                  {ultimo.marcador !== null && ` ${ultimo.marcador}`}
                </span>
                {ultimo.dia !== null && `, ${ultimo.dia}`}
              </>
            )}
          </span>
        </span>
        {registro !== null && (
          // "juntos" va abajo del número y no al lado: así no le saca ancho al nombre.
          <span role="img" aria-label={aria} className="flex shrink-0 flex-col items-end">
            <span className="flex items-baseline gap-[5px]">
              <span className="font-cond text-[34px]">{registro.won}</span>
              <small className="text-[15px] font-semibold text-muted">a</small>
              <span className="font-cond text-[34px]">{registro.lost}</span>
            </span>
            {!enContra && <small className="-mt-1 text-[13px] leading-none font-semibold text-muted">juntos</small>}
          </span>
        )}
      </Link>
    </li>
  )
}
