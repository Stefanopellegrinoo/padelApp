import Link from 'next/link'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { disciplineRulesOf, publicFormats, publicRules, seasonAdminName, seasonHeader } from '@/db/read'
import { serverClient } from '@/db/server'
import { RulesBody, type RulesBlock } from './rules-body'

interface ReglasPageProps {
  params: Promise<{ id: string }>
}

/**
 * Reglas es la única pantalla pública del torneo (`ui-screens.md` §11: "Rol:
 * público. Es la misma pantalla que se comparte por link sin login").
 *
 * Sin sesión no se puede leer `seasons`: RLS pide ser participante, y está bien
 * que así sea. Por eso la rama anónima va por `season_public_rules`, la función
 * `security definer` que devuelve los cinco campos de esta pantalla y nada más.
 *
 * El Plan 3 dejó esta rama construida y correcta, pero **inalcanzable**: el
 * layout llamaba a `seasonHeader()` sin condición y tiraba antes de que la
 * página se montara. Eso lo destraba la Task 12 en `layout.tsx`.
 */
export default async function ReglasPage({ params }: ReglasPageProps) {
  const { id } = await params
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null) {
    // Dos RPC y no uno, y es la forma BARATA (S76): `season_public_rules`
    // (0022) trae los cinco campos de la pantalla pero de UNA sola disciplina,
    // y cambiarle la firma para que traiga todas pedía `drop function` —que se
    // lleva los grants de la única superficie pública del sistema—. Así que
    // `season_public_formats` (0038) va al lado, aditiva. En paralelo: son dos
    // viajes independientes.
    const [rules, formats] = await Promise.all([
      publicRules(supabase, id),
      publicFormats(supabase, id),
    ])
    if (rules === null) {
      // Ya no es "no hay sesión" —eso ahora se muestra—: es link roto o
      // temporada borrada, que es exactamente lo que dice la frase.
      return (
        <div className="flex flex-col gap-4 pt-4">
          <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1>
          <p className="text-pretty text-[13.5px] leading-[1.5] font-medium text-muted">
            Para ver las reglas de este torneo necesitás el link que te pasó tu grupo.
          </p>
          <Link href="/" className="text-[12.5px] font-bold text-accent-link">
            Ir al inicio
          </Link>
        </div>
      )
    }

    // Rebanada 3b de "reglas por disciplina": un bloque por disciplina, en el
    // orden que ya trae `season_public_formats` (`position, created_at`,
    // 0069/0038). `formats` no puede estar vacío acá: `season_public_rules`
    // (que ya devolvió `rules !== null`) es un INNER JOIN contra
    // `disciplines`, así que las dos funciones ven la misma fila o ninguna —
    // no hace falta un `??` para un caso que no puede pasar.
    const disciplines: RulesBlock[] = formats.map((format) => ({
      label: DISCIPLINE_LABELS[format.kind],
      config: format.config,
      shape: { hasMasters: format.hasMasters, pairSize: format.pairSize, allowsDraw: format.allowsDraw },
      text: format.rulesText,
    }))

    return (
      <>
        <RulesBody seasonId={id} disciplines={disciplines} adminName={rules.adminName} isAdmin={false} />
        {/* Sin nav de torneo: quien llega por el link no tiene a dónde ir. */}
        <Link href="/" className="mt-4 text-[12.5px] font-bold text-accent-link">
          Ir al inicio
        </Link>
      </>
    )
  }

  const [header, rulesByDiscipline, adminName] = await Promise.all([
    seasonHeader(supabase, id),
    disciplineRulesOf(supabase, id),
    seasonAdminName(supabase, id),
  ])

  // Rebanada 3b: un bloque por disciplina, ya no sólo la primaria — cada uno
  // con su propia config, su propio shape (0069) y su propio `rules_text`
  // (`disciplineRulesOf`, rebanada 1).
  const disciplines: RulesBlock[] = header.disciplines.map((discipline) => ({
    label: DISCIPLINE_LABELS[discipline.kind],
    config: discipline.config,
    shape: { hasMasters: discipline.hasMasters, pairSize: discipline.pairSize, allowsDraw: discipline.allowsDraw },
    text: rulesByDiscipline.get(discipline.id) ?? '',
  }))

  return (
    <RulesBody seasonId={id} disciplines={disciplines} adminName={adminName} isAdmin={header.isAdmin} />
  )
}
