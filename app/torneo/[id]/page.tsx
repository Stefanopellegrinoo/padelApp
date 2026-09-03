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
 * Con una sola disciplina, el spec (`docs/tipos-de-torneo.md` §2.4, segundo
 * arreglo, línea 225: "Con una sola disciplina, mostrar **una** tabla")
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

  const perDiscipline: DisciplineRanking[] = header.disciplines.map((discipline) => ({
    weight: discipline.weight,
    ranking: computeRanking(seasonAwards.get(discipline.id) ?? new Map(), squadIds, discipline.config, []),
  }))
  const ranking = computeGlobalRanking(perDiscipline)

  const rows: StandingsRow[] = ranking.map((row, index) => {
    const displayName = nameOf.get(row.entryId) ?? ''
    return {
      entryId: row.entryId,
      displayName,
      initials: initials(displayName),
      position: index + 1,
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
        // Sin disciplina: `rows` acá suma puntos de TODAS, no hay una sola a
        // la que apuntar. La fila (`<div onClick>`, no un botón) cae en el
        // redirect de compatibilidad de Task 2 a la disciplina `[0]` -- el
        // MISMO destino que resolvía antes de esa Task (`seasonHeader`
        // ordena `position, created_at`, igual que `defaultDisciplineId`).
        // Lo que SÍ cambia con Task 2: esa pantalla ahora nombra la
        // disciplina en el encabezado con 2+ (`Ana · Pádel`), porque
        // renderiza como cualquier otro perfil -- no es una regresión, pero
        // tampoco es "nada cambió".
        base={`/torneo/${seasonId}`}
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
      />
    </div>
  )
}
