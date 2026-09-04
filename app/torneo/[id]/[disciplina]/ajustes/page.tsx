import { notFound, redirect } from 'next/navigation'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { resolveDisciplineBySlug, validateConfig } from '@/core'
import { Formato } from '@/app/torneo/[id]/ajustes/formato'
import { FormatoDefault } from '@/app/torneo/[id]/ajustes/formato-default'
import { Reglas } from '@/app/torneo/[id]/ajustes/reglas'
import { Volver } from '@/app/torneo/[id]/volver'
import { disciplineRulesOf, seasonHeader, seasonSquadOf } from '@/db/read'
import { serverClient } from '@/db/server'

interface PageProps {
  params: Promise<{ id: string; disciplina: string }>
}

/**
 * Ajustes de UNA disciplina (Task 4, docs/plan-arquitectura-de-paginas.md;
 * docs/arquitectura-de-paginas.md §2.5/§3.2). Su config (puntos y steppers),
 * Masters, formato por defecto de las fechas, y reglas — lo que §3.2 pone
 * del lado de `disciplines`, no de `seasons`. Falta la quinta cosa que §3.2
 * también pone acá, "quién del plantel juega esta disciplina": es §2.6 del
 * diseño, superficie nueva y no una mudanza, y el plan la deja afuera a
 * propósito para esta Task.
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
 * guardar nada.
 */
export default async function DisciplinaAjustesPage({ params }: PageProps) {
  const { id: seasonId, disciplina } = await params
  const supabase = await serverClient()

  const [header, rulesByDiscipline, squad] = await Promise.all([
    seasonHeader(supabase, seasonId),
    disciplineRulesOf(supabase, seasonId),
    seasonSquadOf(supabase, seasonId),
  ])

  const discipline = resolveDisciplineBySlug(header.disciplines, disciplina)
  if (discipline === undefined) notFound()
  if (!header.isAdmin) redirect(`/torneo/${seasonId}/${disciplina}`)

  // Sólo se nombra la disciplina con 2+ — mismo criterio que Stats
  // (`[disciplina]/stats/page.tsx`) y que el propio contenedor.
  const disciplineLabel = header.disciplines.length > 1 ? DISCIPLINE_LABELS[discipline.kind] : null

  // El aviso de plantel es de ESTA disciplina, no de `primaryDiscipline`
  // (`db/read.ts`): ahí es donde vivía el defecto medido en Task 4 — con
  // 2+ disciplinas, el aviso de la [0] no dice nada sobre las demás.
  const mismatch =
    squad.length === discipline.config.squadSize
      ? []
      : validateConfig({ ...discipline.config, squadSize: squad.length }, discipline.pairSize)

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
    </div>
  )
}
