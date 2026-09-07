import { notFound, redirect } from 'next/navigation'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { resolveDisciplineBySlug, validateConfig } from '@/core'
import { Formato } from '@/app/torneo/[id]/ajustes/formato'
import { FormatoDefault } from '@/app/torneo/[id]/ajustes/formato-default'
import { Reglas } from '@/app/torneo/[id]/ajustes/reglas'
import { Volver } from '@/app/torneo/[id]/volver'
import { disciplineRulesOf, seasonHeader, seasonSquadMembersOf } from '@/db/read'
import { squadSeedOrder } from '@/db/season'
import { serverClient } from '@/db/server'
import { QuienJuega, type QuienJuegaMemberVM } from './quien-juega'

interface PageProps {
  params: Promise<{ id: string; disciplina: string }>
}

/**
 * Ajustes de UNA disciplina (Task 4, docs/plan-arquitectura-de-paginas.md;
 * docs/arquitectura-de-paginas.md §2.5/§3.2). Su config (puntos y steppers),
 * Masters, formato por defecto de las fechas, reglas, y "Quién juega" — las
 * cinco cosas que §3.2 pone del lado de `disciplines`, no de `seasons`.
 *
 * "Quién juega" (§2.6 del diseño) es la última en sumarse: `discipline_entries`
 * se llenaba al crear el torneo y en "+ Agregar disciplina"
 * (`db/discipline.ts`) y de ahí en más no había pantalla para tocarla —
 * `entriesOf` (`db/read.ts:515`) descartaba en silencio a quien no jugaba.
 * Sólo se muestra con 2+ disciplinas (`multiDiscipline` acá abajo, mismo
 * criterio que el resto de esta página): con una sola, "el plantel juega
 * esta disciplina" es la única disciplina que hay, y la sección no tiene
 * nada que decir que `Plantel` (el contenedor) no diga ya.
 *
 * Nace para el caso de 2+ disciplinas, donde el contenedor
 * (`../../ajustes/page.tsx`) deja de mostrar estos paneles inline y en su
 * lugar lista cada disciplina con un link para acá (`Disciplinas`,
 * `../../ajustes/disciplinas.tsx`). Con una sola disciplina nada enlaza
 * ACÁ — el contenedor sigue siendo el único Ajustes (§5 del diseño) — pero
 * la ruta funciona igual si se entra por URL directa, mismo criterio que el
 * resto de `[disciplina]/*` (`stats`, `jugador/[entryId]`, `fechas`).
 *
 * Reusa `Formato`/`FormatoDefault`/`Reglas` TAL CUAL: son los mismos paneles
 * que el contenedor ya usaba por disciplina antes de esta Task, con
 * `disciplineLabel: null` porque acá no hace falta desambiguar — el título
 * de la página ya nombra la disciplina cuando hace falta (2+).
 *
 * La guarda es `header.isAdmin`, igual que el contenedor
 * (`../../ajustes/page.tsx`) — cortesía de UI, no la guarda de verdad: las
 * cuatro escrituras de estos paneles (`saveConfig`, `saveHasMasters`,
 * `saveFormatoDefault`, `saveRules`, en `../../ajustes/actions.ts`) pasan
 * por `disciplines_write` (`is_season_admin`, RLS) con `count: 'exact'` —
 * un no-admin que se saltee esta redirección igual se queda sin poder
 * guardar nada. Las dos de "Quién juega" (`addDisciplineMember`,
 * `dropDisciplineMember`) pasan por `discipline_entries_write`
 * (`is_season_admin`, `0023:60-62`), la misma guarda real.
 */
export default async function DisciplinaAjustesPage({ params }: PageProps) {
  const { id: seasonId, disciplina } = await params
  const supabase = await serverClient()

  // `seasonSquadMembersOf`, no `seasonSquadOf`: "Quién juega" necesita el
  // NOMBRE de cada asiento del plantel del CONTENEDOR, no sólo el id — el
  // mismo motivo por el que el contenedor (`../../ajustes/page.tsx`) ya usa
  // ésta y no `entriesOf(seasonId)` sin disciplina (C14).
  const [header, rulesByDiscipline, squad] = await Promise.all([
    seasonHeader(supabase, seasonId),
    disciplineRulesOf(supabase, seasonId),
    seasonSquadMembersOf(supabase, seasonId),
  ])

  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()
  if (!header.isAdmin) redirect(`/torneo/${seasonId}/${disciplina}`)

  // Sólo se nombra la disciplina con 2+ — mismo criterio que Stats
  // (`[disciplina]/stats/page.tsx`) y que el propio contenedor.
  const multiDiscipline = header.disciplines.length > 1
  const disciplineLabel = multiDiscipline ? DISCIPLINE_LABELS[discipline.kind] : null

  // Sólo se pide con 2+ (`multiDiscipline`): con una sola la sección no se
  // dibuja (§5 del diseño) y no hay motivo para pagar esta consulta — y con
  // una sola, `assertMultiDiscipline` (`db/discipline-entries.ts`) le
  // impide a "Quién juega" romper "el plantel del contenedor == la
  // membresía de la disciplina", así que ese caso no lo necesita.
  // `squadSeedOrder` (`db/season.ts:23`) ya lee `discipline_entries.entry_id`
  // de ESTA disciplina — es la misma función que usan `addDiscipline`
  // (`db/discipline.ts:456`, para heredar el orden de la primaria) y el
  // armado de parejas (`db/matchday.ts`), reusada acá en vez de una query
  // nueva contra la misma tabla.
  const disciplinePlayers = multiDiscipline ? await squadSeedOrder(supabase, discipline.id) : []
  const playingIds = new Set<string>(disciplinePlayers)
  const quienJuega: QuienJuegaMemberVM[] = squad.map((member) => ({
    entryId: member.id,
    name: member.displayName,
    playsDiscipline: playingIds.has(member.id),
  }))

  // El aviso de plantel es de ESTA disciplina, no de `primaryDiscipline`
  // (`db/read.ts`): ahí es donde vivía el defecto medido en Task 4 — con
  // 2+ disciplinas, el aviso de la [0] no dice nada sobre las demás.
  //
  // Ronda de fix: la cuenta es la de QUIEN JUEGA esta disciplina
  // (`disciplinePlayers.length`), no la del plantel del torneo entero
  // (`squad.length`) — desde que existe "Quién juega", el plantel del
  // contenedor puede tener más gente que la disciplina (alguien sacado de
  // ÉSTA mientras sigue en OTRA), y esta pantalla es la primera que rompe
  // esa invariante.
  //
  // Con una sola disciplina las dos cuentas COINCIDEN siempre, pero NO
  // porque `assertMultiDiscipline` (`db/discipline-entries.ts`) lo
  // garantice -- esa guarda sólo le impide a las funciones NUEVAS de
  // "Quién juega" romper la igualdad. Lo que la sostiene de verdad son dos
  // caminos que ya existían: `add_squad_seat` con `p_disciplines` en
  // `default null` sube a TODAS las disciplinas de la temporada
  // (`0061:20,56`), y `addSquadSeat` (`db/entries.ts:44-51`) ni siquiera
  // expone ese parámetro -- así que un alta de producción nunca entra a un
  // subconjunto; y sacar del plantel entero (`removeSeat`) cascadea la fila
  // de `discipline_entries` con la de `entries` (`0023:25`, `on delete
  // cascade`). Con una sola disciplina no hay forma de tocar SÓLO esa
  // disciplina fuera de esos dos caminos, así que `squad.length` sigue
  // siendo la cuenta correcta ahí -- la misma que ya usa el contenedor
  // (`../../ajustes/page.tsx:119`), sin tocar.
  const squadSizeHere = multiDiscipline ? disciplinePlayers.length : squad.length
  const mismatch =
    squadSizeHere === discipline.config.squadSize
      ? []
      : validateConfig({ ...discipline.config, squadSize: squadSizeHere }, discipline.pairSize)

  return (
    <div className="flex flex-col gap-4 pt-3">
      <Volver href={`/torneo/${seasonId}/ajustes`} label="Ajustes" />
      <header className="flex flex-col gap-[3px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{header.name}</p>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">
          Ajustes{disciplineLabel !== null ? ` · ${disciplineLabel}` : ''}
        </h1>
      </header>

      {mismatch.map((message) => (
        <p key={message} className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          {message}
        </p>
      ))}

      <Formato
        seasonId={seasonId}
        disciplineId={discipline.id}
        config={discipline.config}
        pairSize={discipline.pairSize}
        hasMasters={discipline.hasMasters}
        disciplineLabel={null}
      />

      <p className="text-[11.5px] font-[600] text-muted">
        Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja.
      </p>

      <FormatoDefault
        seasonId={seasonId}
        disciplineId={discipline.id}
        formatoDefault={discipline.formatoDefault}
        disciplineLabel={null}
      />

      <Reglas
        seasonId={seasonId}
        disciplineId={discipline.id}
        text={rulesByDiscipline.get(discipline.id) ?? ''}
        disciplineLabel={null}
      />

      {/* Sólo con 2+ disciplinas (§5 del diseño): con una sola, el plantel del
          contenedor y "quién juega" son la misma lista, y ya se ve en
          `Plantel` (el contenedor) — esta sección no tendría nada nuevo que
          decir. */}
      {multiDiscipline && (
        <QuienJuega
          seasonId={seasonId}
          disciplineId={discipline.id}
          disciplineLabel={DISCIPLINE_LABELS[discipline.kind]}
          members={quienJuega}
        />
      )}
    </div>
  )
}
