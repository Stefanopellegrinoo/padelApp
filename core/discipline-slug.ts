import type { DisciplineId } from './types'

/** Lo mínimo de una disciplina que hace falta para calcular su slug de URL. */
export interface SluggableDiscipline {
  id: DisciplineId
  kind: 'PADEL' | 'FIFA'
}

/**
 * El slug de cada disciplina de una temporada, DERIVADO — no hay columna
 *`slug` (ninguna migración en esta PR, REQ-NR-5 no la pide). Collision-free
 * por construcción: el sufijo es el ordinal de esa `kind` dentro de la
 * lista, y la lista siempre llega en el mismo orden (`position, created_at`,
 * el criterio ya establecido en `db/read.ts: seasonHeader`). `kind` solo
 * (`'padel'`) NO alcanza: Fase 2 es justamente "dos disciplinas de pádel" en
 * la misma temporada, y ahí `kind` colisiona.
 *
 * Sin sufijo la primera vez de cada kind: hoy toda temporada tiene una sola
 * disciplina (Fase 1), y la URL nueva queda `padel`, no `padel-1`.
 *
 *Nota: el slug se corre si se reordenan disciplinas del mismo `kind`
 * (`position` es editable, ver 0015_disciplines.sql). No hay UI de reorden
 * todavía — si aparece, esto necesita una columna `slug` persistida, no antes.
 */
export function disciplineSlugs<T extends SluggableDiscipline>(
  disciplines: readonly T[],
): Map<DisciplineId, string> {
  const ordinalByKind = new Map<string, number>()
  const slugs = new Map<DisciplineId, string>()
  for (const discipline of disciplines) {
    const kind = discipline.kind.toLowerCase()
    const ordinal = (ordinalByKind.get(kind) ?? 0) + 1
    ordinalByKind.set(kind, ordinal)
    slugs.set(discipline.id, ordinal === 1 ? kind : `${kind}-${ordinal}`)
  }
  return slugs
}

/**
 * La disciplina de la temporada cuyo slug derivado es éste. `undefined`
 *Cubre los dos casos que REQ-NR-5 le deja a la ruta: un slug que no existe
 * (`'basquet'`) y uno de otra temporada — acá nunca calza porque `disciplines`
 * ya llega scopeada a UNA temporada (`seasonHeader`), así que "otra
 * temporada" y "no existe" son el mismo `undefined` para quien llama.
 */
export function resolveDisciplineBySlug<T extends SluggableDiscipline>(
  disciplines: readonly T[],
  slug: string,
): T | undefined {
  const slugs = disciplineSlugs(disciplines)
  return disciplines.find((discipline) => slugs.get(discipline.id) === slug)
}
