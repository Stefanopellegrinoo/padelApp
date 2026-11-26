import Link from 'next/link'
import {
  MASTERS_SIZE,
  formatsLabel,
  narrateRules,
  type DisciplineShape,
  type ReglamentoLine,
  type SeasonConfig,
} from '@/core'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { RulesAccordion, type RuleRow } from './accordion'
import { TEXTO_DE_LA_CASA, renderAdminMarkdown } from './markdown'
import { Reglamento } from './reglamento-vista'

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
  { title: 'Puntos por posición', section: 'Los puntos', value: (c) => c.points.join(', ') },
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

/**
 * Una fecha por ranking (bowling, S4) no tiene partidos: el formato del partido
 * y el desempate de la tabla de partidos no le dicen nada, y el reglamento de
 * arriba ya cuenta cómo gana y cómo se comparte el puesto.
 */
const NO_RANKING = new Set(['Formato de partido', 'Orden de desempate'])

function rulesRowsOf(
  config: SeasonConfig,
  shape: DisciplineShape,
  label: string,
  unit: string,
  ranking: boolean,
): RuleRow[] {
  const sections = narrateRules(config, shape, unit)
  const rows = ROWS.filter((row) => sectionApplies(row.section, shape) && !(ranking && NO_RANKING.has(row.title)))
  return rows.map((row) => {
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
  /** El `kind` del deporte, para su color (`data-deporte`). */
  kind?: string
  /** El reglamento en criollo (`reglamento`), que va ARRIBA. */
  lines: ReglamentoLine[]
  /** Para el acordeón de "Más detalle". */
  config: SeasonConfig
  shape: DisciplineShape
  /** Lo que se cuenta en un partido de este deporte (`unitOf(kind, format)`). */
  unit: string
  /** Las reglas de la casa: el texto libre de quien organiza, de ESTA disciplina. */
  text: string
  /** Slug de URL del deporte, para su "Editar reglas". Sólo la rama con sesión lo sabe. */
  slug?: string
  /** Sus fechas son un ranking por pinos (bowling, S4): sin filas de partidos en "Más detalle". */
  ranking?: boolean
}

export interface RulesBodyProps {
  seasonId: string
  seasonName: string
  /** El "Volver" del encabezado: con sesión, al torneo; sin sesión, al inicio. */
  back: { href: string; label: string }
  /** Un bloque por disciplina, en el orden `position, created_at` que trae `season_public_formats`. */
  disciplines: readonly RulesBlock[]
  adminName: string
  /** Con sesión y siendo quien organiza: aparece el link a Ajustes. Sin sesión es siempre `false`. */
  isAdmin: boolean
}

/**
 * La pantalla de Reglas entera, sin leer nada.
 *
 * Las dos ramas —con sesión y sin sesión— lo renderizan con los mismos props, y
 * por eso son la misma pantalla y no dos que se van a despegar. Es la que se
 * pega en el grupo: tiene que leerse bien sin cuenta y sin la barra de abajo.
 *
 * Arriba el `Hero` (el torneo, "Reglas" y quién organiza). Después una sección
 * por deporte, siempre con su título (docs/torneos-deportes.md §6), y adentro,
 * en este orden: el reglamento como datos (`Reglamento`: una regla por línea,
 * los puntos por puesto en casilleros); las reglas de la casa, si las hay, en
 * letra de leer; y el detalle de siempre, CERRADO bajo "Más detalle". El
 * detalle se ajustó para no contradecir al reglamento, pero no se borró.
 *
 * `<details>` nativo y no un estado de React: abre con toque, Enter y Espacio
 * sin una línea de JS, y llega cerrado.
 */
export function RulesBody({ seasonId, seasonName, back, disciplines, adminName, isAdmin }: RulesBodyProps) {
  // Con 2+ deportes las reglas se editan en el Ajustes de cada uno, no en el general.
  const single = disciplines.length === 1
  return (
    <div className="pb-6">
      <Hero
        back={back}
        kicker={seasonName}
        title="Reglas"
        subtitle={`Organiza ${adminName}`}
        sport={single ? disciplines[0]?.kind : undefined}
      />

      {disciplines.map((discipline, index) => {
        const hasText = discipline.text.trim().length > 0
        return (
          // ponytail: `discipline.label` es `sportLabel(kind)` — dos disciplinas
          // del mismo `kind` (buildable desde PR13) muestran el mismo título.
          // Feo pero honesto: no afirma nada falso, sólo no distingue una de
          // otra. Subir: una columna de nombre por disciplina, hoy no existe.
          <section key={index} data-deporte={discipline.kind} className="px-4 pt-6">
            <h2 className="font-titulo mb-4 text-[26px]">{discipline.label}</h2>
            <Reglamento lines={discipline.lines} points={discipline.config.points} />

            {hasText && (
              <div className="mt-6">
                <h3 className="mb-2 text-[14px] font-semibold text-muted">Reglas de la casa</h3>
                <div
                  className={`${TEXTO_DE_LA_CASA} rounded-tile bg-surface px-4 py-3.5`}
                  // El HTML viene de `renderAdminMarkdown`, que escapa todo el texto libre del admin
                  // antes de aplicarle el subconjunto de formato — ver `markdown.ts`.
                  dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(discipline.text) }}
                />
              </div>
            )}

            <details className="group mt-4">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-btn text-[16px] font-semibold text-accent-link [&::-webkit-details-marker]:hidden">
                <span>Más detalle</span>
                <span aria-hidden className="text-[18px] leading-none">
                  <span className="group-open:hidden">›</span>
                  <span className="hidden group-open:inline">⌄</span>
                </span>
              </summary>
              <RulesAccordion
                rows={rulesRowsOf(
                  discipline.config,
                  discipline.shape,
                  discipline.label,
                  discipline.unit,
                  discipline.ranking === true,
                )}
              />
            </details>

            {isAdmin && !single && discipline.slug !== undefined && (
              <Link
                href={`/torneo/${seasonId}/${discipline.slug}/ajustes`}
                className={`${button('secondary', { full: true })} mt-3`}
              >
                Editar reglas
              </Link>
            )}
          </section>
        )
      })}

      <p className="mx-4 mt-6 border-t border-line pt-4 text-pretty text-[15px] text-muted">{FECHA_ESPECIAL}</p>

      {isAdmin && single && (
        <div className="px-4 pt-4">
          <Link href={`/torneo/${seasonId}/ajustes`} className={button('secondary', { full: true })}>
            Editar reglas
          </Link>
        </div>
      )}
    </div>
  )
}
