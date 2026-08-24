import type { EntryId, Side, SideSize } from './types'

/** Un lado de a uno — FIFA 1v1, o cualquier disciplina con `pairSize: 1`. */
/** Un lado de UNO, angostado: el tipo lo distingue de un lado de dos. */
export type Solo = Extract<Side, { size: 1 }>
/** Un lado de DOS, angostado. Lo que el sorteo de parejas sabe manejar. */
export type Duo = Extract<Side, { size: 2 }>

export function single(a: EntryId): Solo {
  return { size: 1, a }
}

/** Un lado de a dos — todos los lados de hoy, hasta que exista una disciplina con `pairSize: 1`. */
export function pair(a: EntryId, b: EntryId): Duo {
  return { size: 2, a, b }
}

/** Todas las entries del lado, en cualquier orden. Vía barata para donde la aridad no importa. */
export function members(side: Side): readonly EntryId[] {
  return side.size === 1 ? [side.a] : [side.a, side.b]
}

/** Si `entryId` juega en este lado. */
export function includes(side: Side, entryId: EntryId): boolean {
  return side.size === 1 ? side.a === entryId : side.a === entryId || side.b === entryId
}

/**
 * La otra entry del lado, o `null` cuando el lado es de uno. El `null` no es
 * un caso a evitar: es exactamente lo que `pair.a === guestId ? pair.b : pair.a`
 * (sumar-state.ts:92) devolvía como `undefined`, en silencio, antes de este tipo.
 */
export function partnerOf(side: Side, entryId: EntryId): EntryId | null {
  if (side.size === 1) return null
  if (side.a === entryId) return side.b
  if (side.b === entryId) return side.a
  return null
}

/**
 * El único constructor de borde: donde un `Side` nace de una fila cruda (una
 * fila de `pairs`, por ejemplo). Con un discriminante VARIABLE (`row.pair_size`,
 * no un literal) el excess-property check de TS no dispara (S28,
 * ronda 9): `{ size: row.pair_size as SideSize, a, b }` compila limpio y, si
 * `pair_size` es 1, el `b` de la fila queda adentro del objeto sin que nadie
 * pueda leerlo — se pierde en silencio. `sideOfRow` cierra ese agujero: tira
 * si la forma no cierra. (Hasta PR19 lo mismo hacía `pairOf`, que murió con
 * `Pair` y `core/pair-compat.ts`.)
 */
export function sideOfRow(size: SideSize, a: EntryId, b: EntryId | null): Side {
  if (size === 1) {
    // Simétrico con la rama de abajo — antes
    // descartaba un `b` que sobraba EN SILENCIO, exactamente el modo de falla
    // que este constructor existe para cerrar (comentario de arriba).
    if (b !== null) throw new Error('Un lado de a uno con segundo miembro. La fila está rota.')
    return { size: 1, a }
  }
  if (b === null) throw new Error('Un lado de a dos sin segundo miembro. La fila está rota.')
  return { size: 2, a, b }
}

/** Si dos lados son el mismo lado — mismo tamaño, mismas entries, el orden de a/b no importa en un par. */
export function sameSide(left: Side, right: Side): boolean {
  if (left.size === 1) return right.size === 1 && left.a === right.a
  return (
    right.size === 2 &&
    ((left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a))
  )
}
