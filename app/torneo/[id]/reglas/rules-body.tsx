import Link from 'next/link'
import { MASTERS_SIZE, narrateRules, type SeasonConfig } from '@/core'
import { RulesAccordion, type RuleRow } from './accordion'
import { renderAdminMarkdown } from './markdown'

/** "Marce" en el handoff (README línea 341) es el ejemplo, no un nombre fijo: se sustituye por quien organiza. */
function introOf(adminName: string): string {
  return `Las reglas de este torneo, como quedaron cuando ${adminName} lo creó.`
}

/** Los seis títulos del acordeón son contractuales (handoff §12). El cuerpo de cada uno sale de
 * `narrateRules(config)` por título de sección — nunca se reescribe a mano. */
const ROWS: Array<{ title: string; section: string; value: (config: SeasonConfig) => string }> = [
  { title: 'Formato de partido', section: 'La fecha', value: (c) => formatMatch(c.matchFormat) },
  {
    title: 'Cómo se arman las parejas',
    section: 'Cómo se arman las parejas',
    value: () => 'Cruzando el orden de desempate',
  },
  { title: 'Puntos por posición', section: 'Los puntos', value: (c) => c.points.join(' · ') },
  {
    title: 'Orden de desempate',
    section: 'Los desempates',
    value: (c) => `Se refresca cada ${c.tiebreakSnapshotEvery} fechas`,
  },
  {
    title: 'Fechas que cuentan',
    section: 'El torneo',
    value: (c) => `Las mejores ${c.countBestOf} de ${c.regularMatchdays}`,
  },
  { title: 'Masters', section: 'El Masters', value: () => `Los ${MASTERS_SIZE} primeros` },
]

function formatMatch(format: SeasonConfig['matchFormat']): string {
  const setWord = format.setsToWin === 1 ? '1 set' : `${format.setsToWin} sets`
  return `${setWord} a ${format.gamesPerSet} games`
}

function rulesRowsOf(config: SeasonConfig): RuleRow[] {
  const sections = narrateRules(config)
  return ROWS.map((row) => {
    const section = sections.find((candidate) => candidate.title === row.section)
    if (section === undefined) {
      throw new Error(`narrateRules no tiene la sección "${row.section}". Esto es un bug.`)
    }
    return { title: row.title, value: row.value(config), body: section.body }
  })
}

export interface RulesBodyProps {
  seasonId: string
  config: SeasonConfig
  adminName: string
  rulesText: string
  /** Con sesión y siendo quien organiza: aparece el link a Ajustes. Sin sesión es siempre `false`. */
  isAdmin: boolean
}

/**
 * El cuerpo de la pantalla de Reglas, sin leer nada.
 *
 * Las dos ramas —con sesión y sin sesión— lo renderizan con los mismos props, y
 * por eso son la misma pantalla y no dos que se van a despegar. La sin sesión no
 * lee de `seasons` sino de `season_public_rules`, pero lo que dibuja es esto.
 */
export function RulesBody({ seasonId, config, adminName, rulesText, isAdmin }: RulesBodyProps) {
  const hasAdminText = rulesText.trim().length > 0

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
        {introOf(adminName)}
      </p>

      <RulesAccordion rows={rulesRowsOf(config)} />

      {hasAdminText && (
        <div
          className="space-y-2 text-pretty text-[13.5px] leading-[1.5] font-[550] text-text [&_li]:mt-1 [&_strong]:font-extrabold [&_ul]:list-disc [&_ul]:pl-5"
          // El HTML viene de `renderAdminMarkdown`, que escapa todo el texto libre del admin
          // antes de aplicarle el subconjunto de formato — ver `markdown.ts`.
          dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(rulesText) }}
        />
      )}

      {isAdmin && (
        <Link
          href={`/torneo/${seasonId}/ajustes`}
          className="rounded-field border-[1.5px] border-line p-4 text-center text-[14px] font-extrabold"
        >
          Editar reglas
        </Link>
      )}
    </div>
  )
}
