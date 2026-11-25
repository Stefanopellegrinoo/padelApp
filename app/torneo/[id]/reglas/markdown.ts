const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * La tipografía del texto de la casa, la misma en Reglas y en Ajustes: 17 px
 * con interlineado de lectura, párrafos y listas con aire, y negrita de
 * verdad. Es texto para leer (se pega en el grupo), no una línea de dato.
 */
export const TEXTO_DE_LA_CASA =
  'text-pretty text-[17px] leading-[1.55] text-text [&_li]:mt-1.5 [&_li]:pl-1 [&_p+p]:mt-3 [&_p+ul]:mt-2 [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ul+p]:mt-3'

/** `**bold**` only. No nesting, no other inline markers. */
const BOLD = /\*\*([^*]+?)\*\*/g

/**
 * El texto libre del admin, listo para mostrar.
 *
 * Se escapa TODO primero y recién después se aplica el subconjunto de markdown,
 * nunca al revés: si se formatea antes, el escape se come las etiquetas que
 * acabás de generar, y si se escapa después, no escapaste nada.
 *
 * No se acepta HTML del admin ni siquiera "el inofensivo". Esta página se ve
 * SIN cuenta, así que un `<img onerror>` acá le pega a cualquiera que abra el
 * link del grupo.
 *
 * Subconjunto soportado, todo aplicado sobre texto ya escapado: párrafos
 * (líneas separadas por una línea en blanco), saltos de línea simples dentro
 * de un párrafo, `**negrita**`, y listas de líneas que empiezan con `- `
 * (también pegadas a la línea de arriba, sin una en blanco).
 * Deliberadamente NO hay sintaxis de link: nunca se emite un `<a>`, así que un
 * `[texto](javascript:...)` sale como texto escapado y nada más.
 */
export function renderAdminMarkdown(source: string): string {
  const escaped = source.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
  return escaped
    .split(/\n\s*\n/)
    .map(renderBlock)
    .filter((block) => block.length > 0)
    .join('')
}

function renderBlock(block: string): string {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  // Las líneas seguidas del mismo tipo van juntas: las de "- " son una lista y
  // el resto, un párrafo con saltos. Así "Lo que hay que saber:" con la lista
  // justo abajo, sin línea en blanco en el medio, sale como se escribió.
  const runs: { isList: boolean; lines: string[] }[] = []
  for (const line of lines) {
    const isList = line.startsWith('- ')
    const last = runs.at(-1)
    if (last?.isList === isList) last.lines.push(line)
    else runs.push({ isList, lines: [line] })
  }

  return runs
    .map(({ isList, lines: run }) =>
      isList
        ? `<ul>${run.map((line) => `<li>${formatBold(line.slice(2))}</li>`).join('')}</ul>`
        : `<p>${run.map(formatBold).join('<br>')}</p>`,
    )
    .join('')
}

function formatBold(text: string): string {
  return text.replace(BOLD, '<strong>$1</strong>')
}
