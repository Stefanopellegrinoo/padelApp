import type { EntryId, Side } from './types'

/** Un lado de a uno — FIFA 1v1, o cualquier disciplina con `pairSize: 1`. */
export function single(a: EntryId): Side {
  return { size: 1, a }
}

/** Un lado de a dos — todos los lados de hoy, hasta que exista una disciplina con `pairSize: 1`. */
export function pair(a: EntryId, b: EntryId): Side {
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

/** Si dos lados son el mismo lado — mismo tamaño, mismas entries, el orden de a/b no importa en un par. */
export function sameSide(left: Side, right: Side): boolean {
  if (left.size === 1) return right.size === 1 && left.a === right.a
  return (
    right.size === 2 &&
    ((left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a))
  )
}
