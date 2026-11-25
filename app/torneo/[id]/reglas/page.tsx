import Link from 'next/link'
import { reglamento, sportLabel, unitOf } from '@/core'
import { publicFormats, publicRules, seasonHeaderOrNull, type PublicFormat } from '@/db/read'
import { serverClient } from '@/db/server'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { sportsOf } from '../nav-state'
import { volverDestination } from '../tabla-state'
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
      kind: format.kind,
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

  // Dos RPC y no uno, y es la forma BARATA (S76): `season_public_rules`
  // (0022) trae quién organiza y su `null` es el link roto; los deportes
  // vienen de `season_public_formats` (0038/0099). Se leen SIEMPRE, con o sin
  // sesión, así que un logueado que no participa ve exactamente lo mismo que
  // un anónimo. `header` sólo aporta si es participante (y si es admin); es
  // `null` para el anónimo y para quien RLS le oculta la temporada.
  const [rules, formats, header] = await Promise.all([
    publicRules(supabase, id),
    publicFormats(supabase, id),
    user === null ? null : seasonHeaderOrNull(supabase, id),
  ])

  if (rules === null) {
    // Ya no es "no hay sesión" —eso ahora se muestra—: es link roto o
    // temporada borrada, que es exactamente lo que dice la frase.
    return (
      <div className="pb-6">
        <Hero back={{ href: '/', label: 'Inicio' }} title="Reglas" />
        <p className="px-4 pt-6 text-pretty text-[17px] leading-[1.5] text-muted">
          Para ver las reglas de este torneo necesitás el link que te pasó tu grupo.
        </p>
      </div>
    )
  }

  // `formats` no puede estar vacío acá: `season_public_rules` (que ya devolvió
  // `rules !== null`) es un INNER JOIN contra `disciplines`, así que las dos
  // funciones ven la misma fila o ninguna.
  // Mismo orden (`position, created_at`) en `formats` y en `header.disciplines`.
  const slugs = header === null ? [] : sportsOf(header.disciplines).map((sport) => sport.slug)
  // Volver: con lugar en el torneo, el mismo destino que las otras pestañas
  // (Fechas, Stats); quien llega por el link, sin nav de torneo, va al inicio.
  const back = header === null ? { href: '/', label: 'Inicio' } : volverDestination(id, header.disciplines.length)
  return (
    <>
      <RulesBody
        seasonId={id}
        seasonName={rules.name}
        back={back}
        disciplines={blocksOf(formats).map((block, index) => ({ ...block, slug: slugs[index] }))}
        adminName={rules.adminName}
        isAdmin={header?.isAdmin ?? false}
      />
      {/* Quien llega por el link no tiene la barra del torneo: abajo de todo,
          la puerta a la app. */}
      {header === null && (
        <div className="px-4 pb-6">
          <Link href="/" className={button('secondary', { full: true })}>
            Ir al inicio
          </Link>
        </div>
      )}
    </>
  )
}
