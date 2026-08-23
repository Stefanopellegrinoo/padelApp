import Link from 'next/link'
import {
  MASTERS_SIZE,
  formatsLabel,
  narrateRules,
  type MatchFormat,
  type SeasonConfig,
} from '@/core'
import { RulesAccordion, type RuleRow } from './accordion'
import { renderAdminMarkdown } from './markdown'

/** Una disciplina del torneo, como la nombra la fila de formato. */
export interface FormatRow {
  label: string
  matchFormat: MatchFormat
}

/** "Marce" en el handoff (README línea 341) es el ejemplo, no un nombre fijo: se sustituye por quien organiza. */
function introOf(adminName: string): string {
  return `Las reglas de este torneo, como quedaron cuando ${adminName} lo creó.`
}

/** Los seis títulos del acordeón son contractuales (handoff §12). El cuerpo de cada uno sale de
 * `narrateRules(config)` por título de sección — nunca se reescribe a mano. */
const ROWS: Array<{
  title: string
  section: string
  value: (config: SeasonConfig, formats: readonly FormatRow[]) => string
}> = [
  // La ÚNICA fila que puede diferir entre las disciplinas de un torneo: los
  // puntos, las fechas y el desempate son de la temporada, el marcador no
  // (`disciplineProfile`, PR20 rebanada D2). Por eso es la única que recibe la
  //Lista entera — W64,.
  { title: 'Formato de partido', section: 'La fecha', value: (_c, formats) => formatsLabel(formats) },
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

function rulesRowsOf(config: SeasonConfig, formats: readonly FormatRow[]): RuleRow[] {
  const sections = narrateRules(config)
  return ROWS.map((row) => {
    const section = sections.find((candidate) => candidate.title === row.section)
    if (section === undefined) {
      throw new Error(`narrateRules no tiene la sección "${row.section}". Esto es un bug.`)
    }
    return { title: row.title, value: row.value(config, formats), body: section.body }
  })
}

export interface RulesBodyProps {
  seasonId: string
  config: SeasonConfig
  /**
   * El formato de CADA disciplina del torneo. Con una sola la pantalla dice
   * exactamente lo de siempre; con dos formatos distintos los nombra a los dos
   * (W64).
   *
   * La rama SIN SESIÓN también los pasa todos, desde S76: va por
   * `season_public_formats` (`0038`), una función NUEVA y ADITIVA al lado de
   * `season_public_rules` (`0022`). No se le cambió la firma a la vieja porque
   * eso pide `drop function` —Postgres rechaza cambiar el tipo de retorno con
   * `create or replace`— y el drop se lleva los grants, dejando sin superficie
   * pública la única pantalla que se comparte por link.
   *
   * (Este párrafo decía "la rama sin sesión pasa una sola entrada y no puede
   * pasar más". Dejó de ser cierto con S76 y se corrigió acá, criterio de N48:
   * la frase falsa vive en el código.)
   *
   * Lo que SÍ sigue saliendo de una sola config es el RESTO de la pantalla
   * —puntos, fechas, desempates, Masters—, que lee `config` y no `formats`.
   */
  formats: readonly FormatRow[]
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
export function RulesBody({
  seasonId,
  config,
  formats,
  adminName,
  rulesText,
  isAdmin,
}: RulesBodyProps) {
  const hasAdminText = rulesText.trim().length > 0

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
        {introOf(adminName)}
      </p>

      <RulesAccordion rows={rulesRowsOf(config, formats)} />

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
