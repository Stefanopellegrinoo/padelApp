import type { Client } from './client'
import { friendsOf, historyWith, torneosCompartidosCon, type Friend, type SharedMatch } from './friends'

/**
 * Lo que Inicio (`app/torneos/page.tsx`) muestra de cada amigo: el cara a
 * cara y el último resultado. No hay consulta nueva: sale de `friendsOf` y de
 * `historyWith`, las mismas que usan `/amigos` y `/amigos/<id>`, así que
 * Inicio y el perfil del amigo no pueden contar distinto.
 */

export interface Registro {
  won: number
  lost: number
  drew: number
}

export interface AmigoInicio {
  playerId: string
  displayName: string
  /** Enfrentados: lo TUYO contra él. Es el "7 a 5" de la fila. */
  contra: Registro
  /** De compañeros: lo de la pareja de los dos. */
  juntos: Registro
  /** El partido más reciente con resultado, de cualquiera de las dos fuentes. `null` sin ninguno. */
  ultimo: SharedMatch | null
}

const cero = (): Registro => ({ won: 0, lost: 0, drew: 0 })

/**
 * El resumen de un amigo, contado de la lista de `historyWith` tal como
 * llega: ya viene por fecha descendente entre torneo y casual
 * (`porFechaDescendente`), así que el último es el primero que tiene
 * resultado. Un partido de una fecha abierta todavía sin cargar no suma ni es
 * "el último": no pasó nada todavía. Mismo conteo que `resumenDe`
 * (`app/amigos/historial.tsx`), que `db/` no puede importar.
 */
export function resumenAmigo(
  friend: { playerId: string; displayName: string },
  partidos: readonly SharedMatch[],
): AmigoInicio {
  const contra = cero()
  const juntos = cero()
  let ultimo: SharedMatch | null = null
  for (const partido of partidos) {
    if (partido.outcome === null) continue
    ;(partido.together ? juntos : contra)[partido.outcome] += 1
    ultimo ??= partido
  }
  return { playerId: friend.playerId, displayName: friend.displayName, contra, juntos, ultimo }
}

/**
 * Primero con quien jugaste hace menos; después los que tienen un último sin
 * día cargado (una fecha de torneo sin `played_on`) y al final los que
 * todavía no tienen partidos. El desempate es el nombre, así el orden no
 * depende del de `friendships`.
 */
export function ordenarAmigos(amigos: readonly AmigoInicio[]): AmigoInicio[] {
  const rango = (a: AmigoInicio) => (a.ultimo === null ? 2 : a.ultimo.playedOn === null ? 1 : 0)
  return [...amigos].sort((a, b) => {
    const r = rango(a) - rango(b)
    if (r !== 0) return r
    const da = a.ultimo?.playedOn ?? ''
    const db = b.ultimo?.playedOn ?? ''
    if (da !== db) return da < db ? 1 : -1
    return a.displayName.localeCompare(b.displayName, 'es')
  })
}

/**
 * Los amigos aceptados con su resumen, en el orden de Inicio. Las pendientes
 * no van: no hay historial que mostrar (los pedidos van aparte,
 * `pedidosRecibidos`). Con `amigos` ya leídos (`friendsOf`) no los vuelve a
 * leer: Inicio los comparte con los pedidos.
 *
 * Un `historyWith` por amigo, en paralelo: cada uno son hasta diez consultas
 * acotadas por lo que jugaron esos dos. Crece con la cantidad de amigos, que
 * en un grupo es chica; si un día deja de serlo, esto pide una vista que
 * agregue del lado de la base.
 */
export async function amigosDeInicio(supabase: Client, todos?: readonly Friend[]): Promise<AmigoInicio[]> {
  const amigos = (todos ?? (await friendsOf(supabase))).filter((amigo) => amigo.accepted)
  const resumenes = await Promise.all(
    amigos.map(async (amigo) => resumenAmigo(amigo, await historyWith(supabase, amigo.playerId))),
  )
  return ordenarAmigos(resumenes)
}

/** Un pedido de amistad que me hicieron, con los torneos que compartimos (S4): "De Los Pibes del Martes". */
export interface PedidoRecibido {
  playerId: string
  displayName: string
  /** Ordenados por nombre; vacío si no compartimos ninguno. */
  torneos: string[]
}

/**
 * Los pedidos pendientes que me hicieron, de las amistades ya leídas
 * (`friendsOf`), con de dónde lo conozco (`torneosCompartidosCon`). Sin
 * pedidos no lee nada más: Inicio y Amigos sin pedidos quedan como estaban.
 */
export async function pedidosRecibidos(supabase: Client, amigos: readonly Friend[]): Promise<PedidoRecibido[]> {
  const recibidos = amigos.filter((amigo) => !amigo.accepted && amigo.theyAsked)
  if (recibidos.length === 0) return []
  const torneos = await torneosCompartidosCon(
    supabase,
    recibidos.map((amigo) => amigo.playerId),
  )
  return recibidos.map((amigo) => ({
    playerId: amigo.playerId,
    displayName: amigo.displayName,
    torneos: torneos.get(amigo.playerId) ?? [],
  }))
}
