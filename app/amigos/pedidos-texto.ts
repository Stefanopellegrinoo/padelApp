import { haceCuanto } from '@/app/torneo/[id]/[disciplina]/jugador/amistad-texto'

/**
 * Las palabras de los pedidos de amistad (odd/tasks/amigos-faciles.md, S4).
 * Puras: las prueba `pedidos-texto.unit.test.ts`.
 */

/**
 * De dónde lo conocés, por los torneos que comparten (ya ordenados): uno, su
 * nombre; varios, el primero y cuántos más ("Los Pibes del Martes y 1 más",
 * decisión del orquestador). Sin ninguno, nada.
 */
export function deDonde(torneos: readonly string[]): string | null {
  const [primero] = torneos
  if (primero === undefined) return null
  return torneos.length === 1 ? primero : `${primero} y ${torneos.length - 1} más`
}

/** El pedido en Inicio: "Te pidió ser amigos · Los Pibes del Martes". */
export function metaRecibidoEnInicio(torneos: readonly string[]): string {
  const donde = deDonde(torneos)
  return donde === null ? 'Te pidió ser amigos' : `Te pidió ser amigos · ${donde}`
}

/** El pedido en Amigos, abajo del nombre: "De Los Pibes del Martes". Sin torneo compartido no dice nada. */
export function metaRecibidoEnAmigos(torneos: readonly string[]): string | null {
  const donde = deDonde(torneos)
  return donde === null ? null : `De ${donde}`
}

/** Un pedido que mandé: "Sin respuesta · hace 3 días", con la cuenta de `haceCuanto` en minúscula. */
export function metaEnviado(createdAt: string, ahora: Date): string {
  return `Sin respuesta · ${haceCuanto(createdAt, ahora).toLocaleLowerCase('es')}`
}
