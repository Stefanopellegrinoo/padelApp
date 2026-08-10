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
