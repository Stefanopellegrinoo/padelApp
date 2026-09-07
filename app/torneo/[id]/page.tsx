import Link from 'next/link'
import { redirect } from 'next/navigation'
import { computeGlobalRanking, computeRanking, disciplineSlugs, type DisciplineRanking } from '@/core'
import { seasonAwardsOf, seasonHeader, seasonMatchdaysOf, seasonSquadMembersOf } from '@/db/read'
import { serverClient } from '@/db/server'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { initials } from '@/app/format'
import { Desempate, type StandingsRow } from './desempate'
import { singleDisciplineRedirect } from './tabla-state'
import { Volver } from './volver'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Tabla global — home del torneo desde PR12b slice 2/2 (REQ-D9). Hasta acá la
 * raíz mostraba la Tabla de la disciplina por defecto (ahora en
 * `[disciplina]/page.tsx`, PR12b slice 1); esta pantalla suma los puntos de
 * CADA disciplina × su `weight` y muestra a TODO el plantel de la temporada
 * — decisión de producto (engram #3796): "tabla global = suma de todas las
 * disciplinas", y elegida explícitamente sobre mostrar sólo "mi posición".
 *
 * Por disciplina, no una — `computeRanking` se llama UNA VEZ POR disciplina
 * con SU PROPIO `config` (cada una puede tener su propio "mejores N de M") y
 * recién ahí se suman los resultados (`computeGlobalRanking`, PR12). Un solo
 * `computeRanking` con un config compartido aplicaría el corte de la
 * disciplina primaria a las demás — el mismo error que slice 1 evitó con
 * `discipline.config.regularMatchdays` en vez de `header.regularMatchdays`.
 *
 * Lee `seasonSquadMembersOf`/`seasonMatchdaysOf`/`seasonAwardsOf` (temporada
 * entera) — no `entriesOf`/`matchdaysOf`/`awardsOf`/`primaryDiscipline`
 * (disciplina por defecto): esos dejarían afuera a quien no juega esa
 * disciplina en particular. Todo squad member recibe una fila aunque nunca
 * haya sumado un punto: `computeRanking` ya arma una fila por cada id de
 * `squad` que se le pase (medido en `core/ranking.test.ts`, "includes every
 * squad member even if they never played" / "gives a player with no awards
 * zero points") — y acá se le pasa SIEMPRE el plantel de la temporada
 * entera, no el de una disciplina, así que nadie queda afuera del global.
 *
 * Lo que este listado completo NO da: navegación. Un squad member que no
 * está en las entries de NINGUNA disciplina aparece acá con 0 puntos pero no
 * tiene ningún camino a su propio perfil en toda la UI — la fila de esta
 * tabla no es clickeable (ver `Desempate` abajo), y las únicas otras que
 * enlazan a `jugador/{entryId}` (`tabla-view.tsx`, `[disciplina]/stats/page.tsx`)
 * salen de `entriesOf`, que lo deja afuera por la misma razón. No es un
 * defecto — el dueño pidió la fila no clickeable acá — pero listarlo sin
 * darle destino es la otra cara de esa decisión.
 *
 * "Próxima fecha" y "Campeones defensores" no aparecen acá: son conceptos
 * por-disciplina (cada una se juega el día que quiera, decisión #3796) sin
 * versión agregable entre calendarios independientes — viven en la Tabla de
 * cada disciplina. Tampoco hay corte de Masters (`has_masters` también es
 * por-disciplina): `mastersCutoff` se pasa fuera de rango a propósito.
 *
 * DEUDA ACEPTADA (presupuesto de línea): `Desempate` siempre dibuja el botón
 * "Orden de desempate ⇅" — acá no hay snapshot ni cadencia de refresco que
 * explicar (mismo motivo que arriba), así que se le pasa `tiebreakOrder`
 * vacío. Tocarlo (un prop opcional `showTiebreak` para ocultar el botón
 * cuando no aplica) es ~15L en `desempate.tsx`, evaluado y afuera de esta
 * PR por presupuesto. Ningún jugador puntual queda mal representado — no
 * hay `tiedWithEntryId` acá, así que ninguna fila abre el sheet; sólo el
 * botón superior, y quien lo toque ve una lista vacía en vez de nada.
 *
 * `tiedWithEntryId` sigue en `null` acá aun después de que `position`
 * (`computeGlobalRanking`) empezó a compartirse entre empatados (§2.4,
 * primer arreglo). Sigue así A PROPÓSITO, no por descuido: el chip ⓘ y su
 * sheet ("X va antes que Y... y corta el orden inicial/de la fecha N")
 * existen para explicar un criterio de desempate real — el que sí tiene la
 * Tabla de una disciplina, con su snapshot. La global no tiene ninguno, y la
 * decisión del dueño fue exactamente NO inventarle uno: dos empatados en el
 * global no tienen un "antes" que justificar, comparten el número y ya está
 * dicho. Prender el chip acá abriría un sheet que afirma un motivo de orden
 * que no existe (`asOfMatchday`/`tiebreakOrder` vacíos harían decir "corta
 * el orden inicial" y "se actualiza cada 0 fechas" de una tabla sin
 * cadencia) — peor que no mostrar nada.
 *
 * Y no es sólo que el motivo estaría vacío: sería CONTRADICTORIO.
 * `desempate.tsx` elige quién va primero en el sheet con
 * `clickedRow.position < tieMate.position` — con `position` COMPARTIDO esa
 * comparación da `false` para los dos lados (`2 < 2` es `false` mirado desde
 * cualquiera de los dos), así que `first`/`second` quedarían fijos por el
 * `else` (`tieMate` siempre "primero"), y el texto "X va antes que Y" nombraría
 * como ganador a quien NO tocaste el chip — al revés según cuál de los dos
 * apretás. Un motivo que se da vuelta según el click no es un motivo.
 *
 * Con una sola disciplina, el spec (`docs/tipos-de-torneo.md` §2.4, segundo
 * arreglo, línea 257: "Con una sola disciplina, mostrar **una** tabla")
 * manda mostrar una única Tabla — así que esta pantalla redirige derecho a
 * la de esa disciplina en vez de sumar una global aparte al lado. La
 * decisión de redirigir o no vive en `singleDisciplineRedirect`
 * (`tabla-state.ts`), con test propio.
 *
 * `seasonHeader` se espera SOLA, no en el `Promise.all` de abajo: hace falta
 * `header.disciplines.length` para decidir el redirect antes de arrancar
 * cualquier otra query, y arrancar las tres en paralelo dejaría
 * `matchdays`/`squad` como promesas sueltas sin `await` en el camino que
 * redirige — una que rechace ahí es una unhandled rejection. El costo es
 * real y cae en el camino de 2+ disciplinas (el único que sigue dibujando
 * esta pantalla, sin cambios): una ida y vuelta más, porque `seasonHeader`
 * (`db/read.ts:394-405`) ya es 3 queries en paralelo por sí sola.
 */
export default async function TablaGlobalPage({ params }: PageProps) {
  const { id: seasonId } = await params
  const supabase = await serverClient()

  const header = await seasonHeader(supabase, seasonId)

  const redirectTarget = singleDisciplineRedirect(seasonId, header.disciplines)
  if (redirectTarget !== null) redirect(redirectTarget)

  const [matchdays, squad] = await Promise.all([
    seasonMatchdaysOf(supabase, seasonId),
    seasonSquadMembersOf(supabase, seasonId),
  ])
  const seasonAwards = await seasonAwardsOf(supabase, matchdays)

  const squadIds = squad.map((member) => member.id)
  const nameOf = new Map(squad.map((member) => [member.id, member.displayName]))

  // Mismo criterio que "mi posición" en `app/torneos/page.tsx` (`anyClosed`,
  // mismo predicado): antes de que cierre la primera fecha de CUALQUIER
  // disciplina, todo el plantel está en 0 puntos — y con `position`
  // compartido (§2.4) eso los empata a TODOS en el puesto 1. Se lo pasa a
  // `Desempate` como `highlightLeader` para que no resalte a nadie como
  // líder cuando nadie jugó todavía.
  const anyClosed = matchdays.some((matchday) => matchday.kind === 'REGULAR' && matchday.status === 'CLOSED')

  const perDiscipline: DisciplineRanking[] = header.disciplines.map((discipline) => ({
    weight: discipline.weight,
    ranking: computeRanking(seasonAwards.get(discipline.id) ?? new Map(), squadIds, discipline.config, []),
  }))
  const ranking = computeGlobalRanking(perDiscipline)

  const rows: StandingsRow[] = ranking.map((row) => {
    const displayName = nameOf.get(row.entryId) ?? ''
    return {
      entryId: row.entryId,
      displayName,
      initials: initials(displayName),
      // De `computeGlobalRanking`, no `index + 1`: con los mismos puntos hay
      // empate y el puesto se comparte (1, 2, 2, 4) — ver el docblock de
      // `computeGlobalRanking` (`core/global-ranking.ts`).
      position: row.position,
      points: row.points,
      // Sin "fecha anterior" que comparar en un ranking multi-disciplina sin
      // cadencia común, y sin desempate propio (ver doc de `Desempate` arriba).
      movement: null,
      tiedWithEntryId: null,
    }
  })

  const slugOf = disciplineSlugs(header.disciplines)

  return (
    <div className="flex flex-col gap-3 pt-4">
      <Volver href="/torneos" label="Mis torneos" />
      <header className="flex items-start justify-between">
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">{header.name}</h1>
        {header.isAdmin && (
          <Link
            href={`/torneo/${seasonId}/ajustes`}
            aria-label="Ajustes"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip text-[18px]"
          >
            ⚙
          </Link>
        )}
      </header>

      <div className="flex flex-col gap-2">
        {header.disciplines.map((discipline) => (
          <Link
            key={discipline.id}
            href={`/torneo/${seasonId}/${slugOf.get(discipline.id)}`}
            className="flex items-center justify-between rounded-card border border-line bg-surface p-4"
          >
            <p className="text-[15px] font-extrabold">Tabla de {DISCIPLINE_LABELS[discipline.kind]}</p>
            <span className="text-muted">{slugOf.get(discipline.id)} ›</span>
          </Link>
        ))}
      </div>

      <Desempate
        // Sin disciplina: `rows` acá suma puntos de TODAS, no hay un perfil
        // de UNA disciplina al que apuntar. Decisión del dueño: la fila NO
        // es clickeable en la tabla global (`base: null` se lo dice a
        // `Desempate`, que no le pone `onClick` ni `cursor-pointer`).
        base={null}
        rows={rows}
        // Fuera de rango a propósito: el corte de Masters es por-disciplina.
        mastersCutoff={rows.length + 1}
        // Sin snapshot ni desempate propio acá (ver doc de arriba) — el botón
        // "Orden de desempate" de `Desempate` queda inerte, no falso: ninguna
        // fila tiene `tiedWithEntryId`, así que nunca abre con datos de nadie.
        tiebreakOrder={[]}
        tiebreakSnapshotEvery={0}
        asOfMatchday={null}
        nextRefreshMatchday={0}
        // Sin ninguna fecha cerrada, todo el plantel comparte el puesto 1
        // (0 a 0) — ver el comentario de `anyClosed` arriba. No hay líder
        // que resaltar todavía.
        highlightLeader={anyClosed}
      />
    </div>
  )
}
