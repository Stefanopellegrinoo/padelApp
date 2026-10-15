import { MODALITY_ORDER, SPORTS, isSportId, type FirstFecha, type Modality } from '@/core'

/** Cómo se arma la primera fecha; `igualQue` = kind del otro deporte (o `DisciplineId` en Ajustes). */
export type PrimeraFecha = FirstFecha | { igualQue: string }

/** La clave de un valor, para marcar el botón elegido y para el `key` de React. */
export function primeraFechaKey(value: PrimeraFecha): string {
  return typeof value === 'string' ? value : `IGUAL:${value.igualQue}`
}

/** Las modalidades que ofrece la ficha del deporte, en el orden de los botones (no en el de la ficha). */
export function offeredModalities(kind: string): Modality[] {
  const ficha = isSportId(kind) ? SPORTS[kind].ficha : null
  const offered = new Set(ficha?.modalities.map((option) => option.id))
  return MODALITY_ORDER.filter((modality) => offered.has(modality))
}
