/**
 * A dónde volver después de entrar.
 *
 * `next` llega desde la URL, así que sólo se acepta una ruta de esta misma app.
 * Un `next=https://otro-sitio` —o un `//otro-sitio`, que el browser resuelve
 * como protocol-relative— convertiría el login en un redirector abierto: el
 * atacante manda el link, la víctima entra con su cuenta real y termina en la
 * pantalla del atacante con la sesión recién creada.
 *
 * Vive en su propio módulo a propósito. La guarda la necesitan el callback de
 * OAuth y las dos server actions, y si se copia en cada lugar alcanza con que
 * alguien arregle una sola para que las otras queden abiertas.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== 'string') return '/'
  return value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

/**
 * A dónde cae alguien que ACABA de entrar.
 *
 * Es `safeNextPath` más una regla: entrar sin un `next` no te deja en la
 * landing, que es la página para el que todavía no tiene cuenta, sino en Mis
 * torneos. Quien viene de un link de invitación conserva su destino.
 *
 * Vive acá, con `safeNextPath`, y no adentro de las server actions, porque esa
 * regla YA se había arreglado una vez sólo para el login con contraseña: el
 * callback de OAuth seguía usando `safeNextPath` pelado y dejaba en la landing
 * a todo el que entraba con Google. Nadie lo vio porque hasta que hubo
 * credenciales ese camino no se podía recorrer. Una regla en un solo lugar no
 * se puede arreglar a medias.
 */
export function afterLogin(value: string | null | undefined): string {
  const safe = safeNextPath(value)
  return safe === '/' ? '/torneos' : safe
}
