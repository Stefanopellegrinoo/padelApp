import Link from 'next/link'
import { primaryDiscipline, publicRules, seasonAdminName, seasonHeader, seasonRules } from '@/db/read'
import { serverClient } from '@/db/server'
import { RulesBody } from './rules-body'

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
    const rules = await publicRules(supabase, id)
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

    return (
      <>
        <RulesBody
          seasonId={id}
          config={rules.config}
          adminName={rules.adminName}
          rulesText={rules.text}
          isAdmin={false}
        />
        {/* Sin nav de torneo: quien llega por el link no tiene a dónde ir. */}
        <Link href="/" className="mt-4 text-[12.5px] font-bold text-accent-link">
          Ir al inicio
        </Link>
      </>
    )
  }

  const [header, rules, adminName] = await Promise.all([
    seasonHeader(supabase, id),
    seasonRules(supabase, id),
    seasonAdminName(supabase, id),
  ])

  return (
    <RulesBody
      seasonId={id}
      config={primaryDiscipline(header).config}
      adminName={adminName}
      rulesText={rules.text}
      isAdmin={header.isAdmin}
    />
  )
}
