/**
 * Las pantallas de la app que quedan atrás en esta pestaña, para que `Volver`
 * sepa si puede desandar (`history.back()`) o si tiene que ir a su destino fijo
 * — entrar por un link de WhatsApp no deja nada atrás dentro de la app, y
 * `history.back()` ahí te sacaría de ella. El navegador no expone su
 * historial, así que se lleva a mano con lo que ve `usePathname`.
 *
 * ponytail: no distingue un `<Link replace>` de uno normal, así que después
 * de salir de Ajustes por la nav cuenta una pantalla de más. Lo peor que pasa
 * es un `history.back()` que cae una pantalla antes de lo que diría la pila.
 */
export function recorrido(pila: string[], pathname: string): string[] {
  if (pila.at(-1) === pathname) return pila
  if (pila.at(-2) === pathname) return pila.slice(0, -1)
  return [...pila, pathname]
}

let pila: string[] = []

export function registrar(pathname: string): void {
  pila = recorrido(pila, pathname)
}

export function hayAnterior(): boolean {
  return pila.length > 1
}
