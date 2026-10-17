import Link from 'next/link'
import { reglamento, sportLabel, unitOf } from '@/core'
import { publicFormats, publicRules, seasonAdminName, seasonHeader, type PublicFormat } from '@/db/read'
import { serverClient } from '@/db/server'
import { RulesBody, type RulesBlock } from './rules-body'

interface ReglasPageProps {
  params: Promise<{ id: string }>
}

/**
 * Un bloque por deporte, desde lo que devuelve `season_public_formats`: es la
 * única fuente de las dos ramas, así que con y sin sesión dicen lo mismo. El
 * reglamento sale de `reglamento` —la misma función que el wizard— y el
 * acordeón de "Más detalle" de `narrateRules`, con la unidad del deporte.
 */
function blocksOf(formats: PublicFormat[]): RulesBlock[] {
  return formats.map((format) => {
    const shape = {
      hasMasters: format.hasMasters,
      pairSize: format.pairSize,
      fixedTeams: format.fixedTeams,
      allowsDraw: format.allowsDraw,
    }
    return {
      label: sportLabel(format.kind),
      lines: reglamento({ kind: format.kind, ...shape, formatoDefault: format.formatoDefault, config: format.config }),
      config: format.config,
      shape,
      unit: unitOf(format.kind, format.config.matchFormat),
      text: format.rulesText,
    }
  })
}

/**
 * Reglas es la única pantalla pública del torneo (`ui-screens.md` §11: "Rol:
 * público. Es la misma pantalla que se comparte por link sin login").
 *
 * Sin sesión no se puede leer `seasons`: RLS pide ser participante, y está bien
 * que así sea. Por eso la rama anónima va por dos funciones `security definer`
 * que devuelven lo de esta pantalla y nada más: `season_public_rules` (quién
 * organiza) y `season_public_formats` (las reglas de cada deporte).
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
    // (0022) trae quién organiza y su `null` es el link roto; los deportes
    // vienen de `season_public_formats` (0038/0099). En paralelo: son dos
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

    // `formats` no puede estar vacío acá: `season_public_rules` (que ya devolvió
    // `rules !== null`) es un INNER JOIN contra `disciplines`, así que las dos
    // funciones ven la misma fila o ninguna.
    return (
      <>
        <RulesBody seasonId={id} disciplines={blocksOf(formats)} adminName={rules.adminName} isAdmin={false} />
        {/* Sin nav de torneo: quien llega por el link no tiene a dónde ir. */}
        <Link href="/" className="mt-4 text-[12.5px] font-bold text-accent-link">
          Ir al inicio
        </Link>
      </>
    )
  }

  // Con sesión se sigue leyendo lo mismo que sin ella (`publicFormats` está
  // abierta a `authenticated`); `seasonHeader` sólo aporta si es admin.
  const [header, formats, adminName] = await Promise.all([
    seasonHeader(supabase, id),
    publicFormats(supabase, id),
    seasonAdminName(supabase, id),
  ])

  return (
    <RulesBody seasonId={id} disciplines={blocksOf(formats)} adminName={adminName} isAdmin={header.isAdmin} />
  )
}
