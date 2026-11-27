/**
 * Los torneos que compartís con alguien, igual en todos lados y sin fechas
 * (odd/tasks/amigos-faciles.md, S11): las sugerencias de Amigos e Inicio, la
 * pantalla "Ver todas" y los pedidos ("De …", "Te pidió ser amigos · …").
 *
 * - uno: "Los Pibes del Martes"
 * - dos: "Los Pibes del Martes y Copa del Jueves"
 * - tres o más: "Los Pibes del Martes y 2 más"
 *
 * No reordena: el primero es el que eligió la base (el torneo más nuevo,
 * `genteDeTusTorneos` y `torneosCompartidosCon`). Sin ninguno, nada.
 */
export function torneosCompartidos(torneos: readonly string[]): string | null {
  const [primero, segundo] = torneos
  if (primero === undefined) return null
  if (segundo === undefined) return primero
  return torneos.length === 2 ? `${primero} y ${segundo}` : `${primero} y ${torneos.length - 1} más`
}
