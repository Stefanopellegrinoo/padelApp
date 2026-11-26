import type { Phase } from '@/core'

/**
 * Los nombres de las secciones de la llave. Módulo aparte y sin `'use client'`
 * porque los usan las dos puntas: `page.tsx` (servidor) titula la hoja de carga
 * de cada partido y `llave.tsx` (cliente) los encabezados. Una función
 * exportada desde un módulo de cliente no se puede LLAMAR desde el servidor.
 */
export const FASE_LABEL: Record<Phase, string> = {
  GRUPO: 'Fase de grupos',
  OCTAVOS: 'Octavos de final',
  CUARTOS: 'Cuartos de final',
  SEMI: 'Semifinal',
  TERCER_PUESTO: 'Tercer puesto',
  FINAL: 'Final',
}

/** El título de una sección de la llave, que es también el de la hoja de carga de sus partidos. */
export function sectionTitle(fase: Phase, grupo: number): string {
  return fase === 'GRUPO' ? `Grupo ${grupo}` : FASE_LABEL[fase]
}
