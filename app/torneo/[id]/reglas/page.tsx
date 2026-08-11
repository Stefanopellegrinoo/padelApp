import Link from 'next/link'
import { MASTERS_SIZE, narrateRules, type SeasonConfig } from '@/core'
import { seasonHeader, seasonRules } from '@/db/read'
import { serverClient } from '@/db/server'
import { RulesAccordion, type RuleRow } from './accordion'
import { renderAdminMarkdown } from './markdown'

interface ReglasPageProps {
  params: Promise<{ id: string }>
}

const INTRO = 'Las reglas de este torneo, como quedaron cuando Marce lo creó.'

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

/**
 * Reglas es pública (`docs/ui-screens.md` §11: "Rol: público. Es la misma pantalla que se
 * comparte por link sin login"), a diferencia de Tabla/Fechas/Stats. Acá se arma el estado
 * "sin login" para cuando no hay sesión: sin depender de `seasonHeader`/`seasonRules`
 * —que están detrás de RLS y tirarían `EdgeError`— así que se chequea la sesión antes de
 * pedir nada del torneo.
 *
 * OJO: el shell de `app/torneo/[id]/layout.tsx` (Task 5, fuera del alcance de esta tarea) ya
 * llama a `seasonHeader` sin chequear sesión y tira `EdgeError` antes de que este componente
 * llegue a montarse, y ese layout dibuja el nav del torneo siempre, sin importar qué renderice
 * esta página. Este branch queda listo y correcto para cuando esa guarda se resuelva, pero hoy
 * no es alcanzable navegando de verdad sin sesión — ver reporte de la tarea.
 */
export default async function ReglasPage({ params }: ReglasPageProps) {
  const { id } = await params
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null) {
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

  const [header, rules] = await Promise.all([seasonHeader(supabase, id), seasonRules(supabase, id)])
  const rows = rulesRowsOf(header.config)
  const hasAdminText = rules.text.trim().length > 0

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Reglas</h1>
      <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">{INTRO}</p>

      <RulesAccordion rows={rows} />

      {hasAdminText && (
        <div
          className="space-y-2 text-pretty text-[13.5px] leading-[1.5] font-[550] text-text [&_li]:mt-1 [&_strong]:font-extrabold [&_ul]:list-disc [&_ul]:pl-5"
          // El HTML viene de `renderAdminMarkdown`, que escapa todo el texto libre del admin
          // antes de aplicarle el subconjunto de formato — ver `markdown.ts`.
          dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(rules.text) }}
        />
      )}

      {header.isAdmin && (
        <Link
          href={`/torneo/${id}/ajustes`}
          className="rounded-field border-[1.5px] border-line p-4 text-center text-[14px] font-extrabold"
        >
          Editar reglas
        </Link>
      )}
    </div>
  )
}
