import Link from 'next/link'
import {
  MASTERS_SIZE,
  formatsLabel,
  narrateRules,
  type DisciplineShape,
  type ReglamentoLine,
  type SeasonConfig,
} from '@/core'
import { RulesAccordion, type RuleRow } from './accordion'
import { renderAdminMarkdown } from './markdown'

/** "Marce" en el handoff (README línea 341) es el ejemplo, no un nombre fijo: se sustituye por quien organiza. */
function introOf(adminName: string): string {
  return `Las reglas de este torneo, como quedaron cuando ${adminName} lo creó.`
}

/** Va una sola vez, al final: lo que vale para todos los deportes del torneo. */
const FECHA_ESPECIAL = 'Alguna fecha puede jugarse a otra cosa: se avisa en esa fecha.'

/**
 * Los seis títulos son el contrato de PÁDEL con Masters (handoff §12):
 * `pairSize === 2 && hasMasters`, la única forma que existía antes de las
 * fichas. No es universal — FIFA 1v1 (`hasMasters: false, pairSize: 1`) pasa
 * de seis filas a CUATRO, porque "Masters" y "Cómo se arman las parejas" se
 * filtran (`sectionApplies`, abajo), y las parejas fijas pierden la segunda.
 * El cuerpo de cada fila sigue saliendo de `narrateRules(config, shape, unit)`
 * por título de sección — nunca se reescribe a mano.
 */
const ROWS: Array<{
  title: string
  section: string
  value: (config: SeasonConfig, label: string, unit: string) => string
}> = [
  // La ÚNICA fila que lee algo más que `config`. Un bloque es una disciplina,
  // así que `formatsLabel` ve siempre un arreglo de UN elemento: con uno solo
  // devuelve la frase del formato sin prefijo (`narrate.ts`, `distinct.length
  // <= 1`). Se llama así y no con `formatLabel` directo porque el barril de
  // `core/` no lo exporta a propósito (S77). `unit` es lo que se cuenta en el
  // deporte de este bloque.
  {
    title: 'Formato de partido',
    section: 'La fecha',
    value: (config, label, unit) => formatsLabel([{ label, matchFormat: config.matchFormat, unit }]),
  },
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

/**
 * El predicado que decide si una fila del acordeón tiene sentido para esta
 * disciplina — el MISMO que usa `narrateRules` para decidir si produce la
 * sección (design §Q4, "both, from one shared predicate"): así una fila
 * nunca puede pedir una sección que `narrateRules` decidió no escribir, ni al
 * revés. Toda sección que no está acá se considera SIEMPRE presente, así que
 * si alguna vez falta de verdad, el `throw` de abajo la sigue atajando.
 */
function sectionApplies(section: string, shape: DisciplineShape): boolean {
  if (section === 'El Masters') return shape.hasMasters
  if (section === 'Cómo se arman las parejas') return shape.pairSize === 2 && !shape.fixedTeams
  return true
}

function rulesRowsOf(config: SeasonConfig, shape: DisciplineShape, label: string, unit: string): RuleRow[] {
  const sections = narrateRules(config, shape, unit)
  return ROWS.filter((row) => sectionApplies(row.section, shape)).map((row) => {
    const section = sections.find((candidate) => candidate.title === row.section)
    if (section === undefined) {
      throw new Error(`narrateRules no tiene la sección "${row.section}". Esto es un bug.`)
    }
    return { title: row.title, value: row.value(config, label, unit), body: section.body }
  })
}

/**
 * Un bloque de Reglas: un deporte completo, con todo lo que necesita para
 * contarse solo. Misma forma para las dos ramas de la pantalla (con y sin
 * sesión): las dos lo arman desde `season_public_formats` (`publicFormats`),
 * sin ningún id — la rama pública no tiene uno que dar (0038/0069 lo dejan
 * afuera del RPC a propósito).
 */
export interface RulesBlock {
  label: string
  /** El reglamento en criollo (`reglamento`), que va ARRIBA. */
  lines: ReglamentoLine[]
  /** Para el acordeón de "Más detalle". */
  config: SeasonConfig
  shape: DisciplineShape
  /** Lo que se cuenta en un partido de este deporte (`unitOf(kind, format)`). */
  unit: string
  /** Las reglas de la casa: el texto libre de quien organiza, de ESTA disciplina. */
  text: string
}

export interface RulesBodyProps {
  seasonId: string
  /** Un bloque por disciplina, en el orden `position, created_at` que trae `season_public_formats`. */
  disciplines: readonly RulesBlock[]
  adminName: string
  /** Con sesión y siendo quien organiza: aparece el link a Ajustes. Sin sesión es siempre `false`. */
  isAdmin: boolean
}

/**
 * El cuerpo de la pantalla de Reglas, sin leer nada.
 *
 * Las dos ramas —con sesión y sin sesión— lo renderizan con los mismos props, y
 * por eso son la misma pantalla y no dos que se van a despegar.
 *
 * Una tarjeta por deporte, siempre con su título (docs/torneos-deportes.md §6),
 * y adentro, en este orden: el reglamento en criollo; las reglas de la casa,
 * si las hay; y el detalle de siempre, CERRADO bajo "Más detalle". El detalle
 * se ajustó para no contradecir al reglamento, pero no se borró.
 *
 * `<details>` nativo y no un estado de React: abre con toque, Enter y Espacio
 * sin una línea de JS, y llega cerrado.
 */
export function RulesBody({ seasonId, disciplines, adminName, isAdmin }: RulesBodyProps) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
        {introOf(adminName)}
      </p>

      {disciplines.map((discipline, index) => {
        const hasText = discipline.text.trim().length > 0
        return (
          // ponytail: `discipline.label` es `sportLabel(kind)` — dos disciplinas
          // del mismo `kind` (buildable desde PR13) muestran el mismo título.
          // Feo pero honesto: no afirma nada falso, sólo no distingue una de
          // otra. Subir: una columna de nombre por disciplina, hoy no existe.
          <section key={index} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <h2 className="text-[17px] font-extrabold tracking-[-.02em]">{discipline.label}</h2>
            <p className="text-pretty text-[14px] leading-[1.5] font-[550] text-text">
              {discipline.lines.map((line) => line.text).join(' ')}
            </p>

            {hasText && (
              <div className="flex flex-col gap-1">
                <h3 className="text-[12px] font-extrabold uppercase tracking-[.14em] text-muted">
                  Reglas de la casa
                </h3>
                <div
                  className="space-y-2 text-pretty text-[13.5px] leading-[1.5] font-[550] text-text [&_li]:mt-1 [&_strong]:font-extrabold [&_ul]:list-disc [&_ul]:pl-5"
                  // El HTML viene de `renderAdminMarkdown`, que escapa todo el texto libre del admin
                  // antes de aplicarle el subconjunto de formato — ver `markdown.ts`.
                  dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(discipline.text) }}
                />
              </div>
            )}

            <details className="group">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-field text-[14px] font-extrabold text-accent-link outline-none focus-visible:ring-2 focus-visible:ring-accent-link [&::-webkit-details-marker]:hidden">
                <span>Más detalle</span>
                <span aria-hidden className="text-[16px] leading-none">
                  <span className="group-open:hidden">›</span>
                  <span className="hidden group-open:inline">⌄</span>
                </span>
              </summary>
              <RulesAccordion
                rows={rulesRowsOf(discipline.config, discipline.shape, discipline.label, discipline.unit)}
              />
            </details>
          </section>
        )
      })}

      <p className="text-pretty text-[12.5px] leading-[1.5] font-[550] text-muted">{FECHA_ESPECIAL}</p>

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
