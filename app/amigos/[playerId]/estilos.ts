// El registro de la hoja de un partido con un amigo, en el lenguaje del
// prototipo: campos de 16 px (sin zoom de iOS), preguntas en 17 como las de la
// hoja de la fecha (`PREGUNTA`, `carga.tsx`) y opciones como sus "Ganó": tinte
// de opción y, elegida, el bloque. Sin `outline-none`: el anillo de foco
// global (`globals.css`) es el que dice dónde estás. Aparte porque lo
// comparten `cargar.tsx` y las secciones de resultado.
export const INPUT =
  'min-h-[48px] w-full min-w-0 rounded-btn border-[1.5px] border-line bg-surface-2 px-3 text-[16px] font-semibold text-text'
export const LABEL = 'text-[15px] font-semibold text-muted'
export const PREGUNTA = 'text-[17px] font-bold'
/** Una opción de un grupo de radios, dibujada como botón: el radio queda accesible pero invisible. */
export const OPTION =
  'flex min-h-[48px] flex-1 cursor-pointer items-center justify-center rounded-btn bg-opcion px-3 text-center text-[16px] font-bold text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)] has-[:checked]:bg-block has-[:checked]:text-on-block has-[:checked]:shadow-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus'
