/**
 * La receta del chip (odd/tasks/amigos-faciles.md, S6: "los botones de agregar
 * son muy grandes"): 34 px a la vista, pero el `::after` estira la zona de
 * toque a 44 (5 px arriba y abajo), como pide la guía de accesibilidad. Sirve
 * igual para un `<button>`, un `<Link>` o un `<span>` que sólo marca un estado.
 *
 * - `onBlock`: el lleno, blanco sobre el bloque del Hero ("Agregar").
 * - `hueca`: el borde suave sobre el bloque, para un estado ("Enviado", "Amigos ›").
 * - `claro`: sobre el fondo claro de una lista.
 * - `claroHecho`: el estado sobre el fondo claro ("Enviado" en "Gente de tus torneos").
 */
export type ChipVariant = 'onBlock' | 'hueca' | 'claro' | 'claroHecho'

const BASE =
  "press relative inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-pill px-3 text-[14px] font-extrabold after:absolute after:-inset-x-1 after:-inset-y-[5px] after:content-['']"

const VARIANT: Record<ChipVariant, string> = {
  onBlock: 'bg-on-block text-block',
  hueca: 'text-on-block shadow-[inset_0_0_0_1.5px_var(--color-on-block-soft)]',
  claro: 'bg-opcion text-accent-link',
  claroHecho: 'text-muted',
}

export function chip(variant: ChipVariant): string {
  return `${BASE} ${VARIANT[variant]}`
}
