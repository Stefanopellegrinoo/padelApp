// El registro de la casa para formularios: campos de `eliminar.tsx`, rótulos
// en mayúscula de la carga de fechas (`PROMPT`, `carga.tsx`), opciones como
// el `Opciones` de `/rapido` (elegida en verde lleno, el resto en chip).
// Aparte porque lo comparten `cargar.tsx` y las secciones de resultado.
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-accent-link'
export const INPUT = `w-full min-w-0 rounded-field border-[1.5px] border-line bg-bg p-[13px] text-[16px] font-bold text-text ${FOCUS}`
export const LABEL = 'text-[12px] font-extrabold text-muted'
export const LEGEND = 'text-[12px] font-extrabold uppercase tracking-[.14em] text-muted'
/** Una opción de un grupo de radios, dibujada como botón: el radio queda accesible pero invisible. */
export const OPTION =
  'flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-field bg-chip p-3 text-center text-[14px] font-extrabold has-[:checked]:bg-accent has-[:checked]:text-accent-text has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-link'
