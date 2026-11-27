import { haceCuanto } from '@/app/torneo/[id]/[disciplina]/jugador/amistad-texto'
import { torneosCompartidos } from './torneos-texto'

/**
 * Las palabras de los pedidos de amistad (odd/tasks/amigos-faciles.md, S4).
 * Puras: las prueba `pedidos-texto.unit.test.ts`.
 */

/**
 * El pedido en Inicio: "Te pidió ser amigos · Los Pibes del Martes". De dónde
 * lo conocés va en el formato de S11 (`torneosCompartidos`).
 */
export function metaRecibidoEnInicio(torneos: readonly string[]): string {
  const donde = torneosCompartidos(torneos)
  return donde === null ? 'Te pidió ser amigos' : `Te pidió ser amigos · ${donde}`
}

/** El pedido en Amigos, abajo del nombre: "De Los Pibes del Martes". Sin torneo compartido no dice nada. */
export function metaRecibidoEnAmigos(torneos: readonly string[]): string | null {
  const donde = torneosCompartidos(torneos)
  return donde === null ? null : `De ${donde}`
}

/** Un pedido que mandé: "Sin respuesta · hace 3 días", con la cuenta de `haceCuanto` en minúscula. */
export function metaEnviado(createdAt: string, ahora: Date): string {
  return `Sin respuesta · ${haceCuanto(createdAt, ahora).toLocaleLowerCase('es')}`
}
