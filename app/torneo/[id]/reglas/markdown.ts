const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

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
 * de un párrafo, `**negrita**`, y listas de líneas que empiezan con `- `.
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
  if (lines.length === 0) return ''

  const isList = lines.every((line) => line.startsWith('- '))
  if (isList) {
    const items = lines.map((line) => `<li>${formatBold(line.slice(2))}</li>`).join('')
    return `<ul>${items}</ul>`
  }

  return `<p>${lines.map(formatBold).join('<br>')}</p>`
}

function formatBold(text: string): string {
  return text.replace(BOLD, '<strong>$1</strong>')
}
