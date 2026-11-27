/**
 * Las palabras del control de amistad del perfil del torneo
 * (odd/tasks/amigos-faciles.md, S2). Puras: la página las arma del lado del
 * servidor y el control sólo las muestra.
 */

/** A la persona se la nombra por su primer nombre, como en la maqueta: "Le mandaste el pedido a Nico". */
export function primerNombre(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || 'este jugador'
}

const DIA = 24 * 60 * 60 * 1000

/**
 * Cuánto hace que llegó el pedido ("Hace 2 días"), en días enteros
 * transcurridos. Un reloj corrido que lo deja en el futuro es "Hoy".
 */
export function haceCuanto(desde: string, ahora: Date): string {
  const dias = Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / DIA))
  if (dias === 0) return 'Hoy'
  return dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`
}

/**
 * "Amigos ›" lleva al historial entre los dos. `?desde=amigos` hace que su
 * Volver diga "Amigos" (`app/amigos/[playerId]/page.tsx`): el perfil del
 * torneo no es un origen que esa pantalla conozca, y entre Inicio y la lista
 * de Amigos, ésta es la que sigue el hilo de "son amigos".
 */
export function amigosHref(playerId: string): string {
  return `/amigos/${playerId}?desde=amigos`
}
