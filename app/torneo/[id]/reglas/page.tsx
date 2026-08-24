import Link from 'next/link'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import {
  primaryDiscipline,
  publicFormats,
  publicRules,
  seasonAdminName,
  seasonHeader,
  seasonRules,
} from '@/db/read'
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

    return (
      <>
        <RulesBody
          seasonId={id}
          config={rules.config}
          // TODAS las disciplinas, igual que la rama con sesión. Con una sola
          // `formatsLabel` no usa la etiqueta —agrupa por FORMATO, no por
          // disciplina— así que esa pantalla sale byte a byte como salía; con
          // dos, cada formato queda nombrado.
          //
          // El `??` no es defensa de cinturón: si `season_public_formats`
          // devolviera vacío para una temporada que `season_public_rules` SÍ
          // encontró, narrar el formato de la config que ya tenemos es mejor
          // que narrar nada. No debería pasar —las dos leen `disciplines`—
          // pero son dos viajes distintos.
          formats={
            formats.length > 0
              ? formats.map((format) => ({
                  label: DISCIPLINE_LABELS[format.kind],
                  matchFormat: format.config.matchFormat,
                }))
              : [{ label: '', matchFormat: rules.config.matchFormat }]
          }
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
      // La fila de formato mira TODAS las disciplinas, no la [0]: desde PR20
      // rebanada D2 cada una nace con la forma de marcador de su kind, y un
      // torneo de pádel + FIFA le decía al grupo "1 set a 4 games" sobre una
      // mitad que se juega a goles.
      formats={header.disciplines.map((discipline) => ({
        label: DISCIPLINE_LABELS[discipline.kind],
        matchFormat: discipline.config.matchFormat,
      }))}
      adminName={adminName}
      rulesText={rules.text}
      isAdmin={header.isAdmin}
    />
  )
}
