import { Fragment } from 'react'
import Link from 'next/link'
import {
  MASTERS_SIZE,
  formatsLabel,
  narrateRules,
  type DisciplineShape,
  type SeasonConfig,
} from '@/core'
import { RulesAccordion, type RuleRow } from './accordion'
import { renderAdminMarkdown } from './markdown'

/** "Marce" en el handoff (README línea 341) es el ejemplo, no un nombre fijo: se sustituye por quien organiza. */
function introOf(adminName: string): string {
  return `Las reglas de este torneo, como quedaron cuando ${adminName} lo creó.`
}

/**
 * Los seis títulos son el contrato de PÁDEL con Masters (handoff §12):
 * `pairSize === 2 && hasMasters`, la única forma que existe hoy en
 * producción. No es universal — FIFA 1v1 (`hasMasters: false, pairSize: 1`)
 * pasa de seis filas a CUATRO, porque "Masters" y "Cómo se arman las
 * parejas" se filtran (`sectionApplies`, abajo). El cuerpo de cada fila
 * sigue saliendo de `narrateRules(config, shape)` por título de sección —
 * nunca se reescribe a mano.
 */
const ROWS: Array<{
  title: string
  section: string
  value: (config: SeasonConfig, label: string) => string
}> = [
  // La ÚNICA fila que lee algo más que `config`: `formatsLabel` con un
  // arreglo de UN elemento (el de este bloque) es byte a byte lo mismo que
  // `formatLabel(config.matchFormat)` (`narrate.ts:44-46`, distinct.length
  // <= 1 devuelve `distinct[0]` sin prefijo) — se llama así, y no con
  // `formatLabel` directo, porque el barril de `core/` no la exporta a
  // propósito (S77): esa puerta es por la que entró W64, y no hace falta
  // abrirla para narrar un solo bloque.
  //
  // Desde la rebanada 3b cada bloque es una disciplina, así que esto ya NO
  // agrupa varias — agrupar era el trabajo de `formatsLabel` cuando esta fila
  // narraba el torneo entero (una fila, `formats: FormatRow[]`); ahora hay
  // una fila por bloque y esta llamada siempre ve un arreglo de largo 1.
  {
    title: 'Formato de partido',
    section: 'La fecha',
    value: (config, label) => formatsLabel([{ label, matchFormat: config.matchFormat }]),
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
  if (section === 'Cómo se arman las parejas') return shape.pairSize !== 1
  return true
}

function rulesRowsOf(config: SeasonConfig, shape: DisciplineShape, label: string): RuleRow[] {
  const sections = narrateRules(config, shape)
  return ROWS.filter((row) => sectionApplies(row.section, shape)).map((row) => {
    const section = sections.find((candidate) => candidate.title === row.section)
    if (section === undefined) {
      throw new Error(`narrateRules no tiene la sección "${row.section}". Esto es un bug.`)
    }
    return { title: row.title, value: row.value(config, label), body: section.body }
  })
}

/**
 * Un bloque de Reglas: una disciplina completa, con todo lo que necesita para
 * narrarse sola — su config, su shape (`hasMasters`/`pairSize`/`allowsDraw`,
 * que viven en `disciplines` y no en `config`) y su propio texto libre.
 *
 * Misma forma para las dos ramas de la pantalla: la CON sesión la arma desde
 * `header.disciplines` + `disciplineRulesOf`, la SIN sesión desde
 * `publicFormats` (`season_public_formats`, 0069) — ninguna de las dos
 * necesita un id acá, así que no lo lleva (la rama pública no tiene uno que
 * dar: `0038`/`0069` lo dejan afuera del RPC a propósito).
 */
export interface RulesBlock {
  label: string
  config: SeasonConfig
  shape: DisciplineShape
  text: string
}

export interface RulesBodyProps {
  seasonId: string
  /**
   * Un bloque por disciplina, en el orden `position, created_at` que ya traen
   * las dos consultas de origen. Con UNA sola disciplina la pantalla sale
   * byte a byte como salía antes de la rebanada 3b (design §Q2): no hay
   * encabezado que agregar y no hay una segunda cosa que nombrar.
   */
  disciplines: readonly RulesBlock[]
  adminName: string
  /** Con sesión y siendo quien organiza: aparece el link a Ajustes. Sin sesión es siempre `false`. */
  isAdmin: boolean
}

/**
 * El cuerpo de la pantalla de Reglas, sin leer nada.
 *
 * Las dos ramas —con sesión y sin sesión— lo renderizan con los mismos props, y
 * por eso son la misma pantalla y no dos que se van a despegar. La sin sesión no
 * lee de `seasons` sino de `season_public_formats`, pero lo que dibuja es esto.
 *
 * N bloques apilados, uno por disciplina (design §Q2). El título de cada uno
 * sale SÓLO cuando hay más de uno (`disciplines.length > 1`) — la decisión
 * vive ACÁ, no en lo que manda cada rama, para que haya un solo lugar que
 * pueda olvidarla en vez de dos. Mismo criterio que `narrate.ts:34-37` usa
 * para el prefijo de `formatsLabel`: el prefijo/encabezado aparece recién
 * cuando hay dos cosas distintas que decir.
 *
 * Sin `<div>` extra por bloque: con una sola disciplina no hay encabezado que
 * dibujar, así que un bloque de uno sale exactamente como salía la pantalla
 * de un solo bloque compartido — el acordeón y el texto libre quedan hijos
 * directos del contenedor de siempre, ni un tag de más.
 */
export function RulesBody({ seasonId, disciplines, adminName, isAdmin }: RulesBodyProps) {
  const showHeadings = disciplines.length > 1

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
        {introOf(adminName)}
      </p>

      {disciplines.map((discipline, index) => {
        const hasText = discipline.text.trim().length > 0
        return (
          <Fragment key={index}>
            {showHeadings && (
              <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                {discipline.label}
              </h2>
            )}
            <RulesAccordion rows={rulesRowsOf(discipline.config, discipline.shape, discipline.label)} />
            {hasText && (
              <div
                className="space-y-2 text-pretty text-[13.5px] leading-[1.5] font-[550] text-text [&_li]:mt-1 [&_strong]:font-extrabold [&_ul]:list-disc [&_ul]:pl-5"
                // El HTML viene de `renderAdminMarkdown`, que escapa todo el texto libre del admin
                // antes de aplicarle el subconjunto de formato — ver `markdown.ts`.
                dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(discipline.text) }}
              />
            )}
          </Fragment>
        )
      })}

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
