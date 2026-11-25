import { unstable_rethrow } from 'next/navigation'

/**
 * Cuando una server action ni siquiera vuelve.
 *
 * Una action que rechaza algo devuelve su error (`WriteResult`,
 * `CasualFormState`) y la hoja lo muestra. Pero si se cortó la red en el
 * club, el `fetch` de la action rechaza y la promesa TIRA: sin atraparla,
 * React la manda a `app/error.tsx`, la hoja desaparece y lo cargado se
 * pierde (T17). Las hojas de carga (la de la fecha y la del partido con un
 * amigo) la atrapan con esto y se quedan abiertas con el mensaje.
 *
 * Lo que Next tira a propósito —un `redirect()` de la action, un
 * `notFound()`— no es una falla: `unstable_rethrow` lo deja seguir.
 */
export const SIN_CONEXION = 'Sin conexión. Probá de nuevo.'
export const NO_SE_PUDO = 'No se pudo guardar. Probá de nuevo.'

/**
 * ¿La red? El navegador ya sabe que no hay, o el `fetch` falló como falla sin
 * red: un `TypeError` ("Failed to fetch" en Chrome, "NetworkError…" en
 * Firefox, "Load failed" en Safari).
 */
export function pareceSinConexion(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message)
}

/** El mensaje para la hoja cuando la action tiró. Lo que es de Next lo vuelve a tirar. */
export function mensajeDeFalla(error: unknown): string {
  unstable_rethrow(error)
  return pareceSinConexion(error) ? SIN_CONEXION : NO_SE_PUDO
}
