/**
 * Derivaciones puras de la pantalla "Armar": filtrar los nombres con
 * contenido real, y el armado de parejas fijas a los toques (tocás a dos
 * jugadores y quedan emparejados). `rapido-state.ts` valida el `Armado` ya
 * terminado; esto es la interacción de ir construyéndolo, así que vive
 * aparte y no lo toca.
 */

/** Los nombres con contenido real, en el mismo orden — mismo criterio que usa `armar` puertas adentro. */
export function nombresValidos(jugadores: readonly string[]): string[] {
  return jugadores.map((nombre) => nombre.trim()).filter((nombre) => nombre.length > 0)
}

/**
 * Si un cambio en la lista de nombres tira abajo las parejas ya armadas.
 *
 * Las parejas fijas son índices sobre la lista FILTRADA, así que lo único que
 * las invalida es que cambie la CANTIDAD de nombres con contenido: ahí los
 * índices se corren y cada pareja pasa a apuntar a otra persona. Vaciar o
 * llenar un nombre lo hace aunque no se haya agregado ni sacado ninguna fila.
 *
 * Y al revés, que es donde estaba el bug: agregar un casillero VACÍO no cambia
 * nada, y sin embargo borraba las cuatro parejas que costaron ocho toques.
 * Resetear de más es tan defecto como resetear de menos — por eso la regla es
 * una sola y vive acá, donde un test la mira.
 */
export function seCaenLasParejas(antes: readonly string[], despues: readonly string[]): boolean {
  return nombresValidos(antes).length !== nombresValidos(despues).length
}

/**
 * Un toque sobre el jugador `indice`. El flujo es "tocás a dos y quedan
 * emparejados": tocar a alguien ya emparejado lo separa (para poder rehacer
 * la pareja sin sacarlo de la lista), tocar al que está pendiente cancela la
 * espera, y tocar a un tercero cierra la pareja con el que estaba esperando.
 */
export function tocarJugador(
  pares: Array<[number, number]>,
  pendiente: number | null,
  indice: number,
): { pares: Array<[number, number]>; pendiente: number | null } {
  const emparejado = pares.find(([a, b]) => a === indice || b === indice)
  if (emparejado !== undefined) {
    return { pares: pares.filter((par) => par !== emparejado), pendiente }
  }
  if (pendiente === indice) {
    return { pares, pendiente: null }
  }
  if (pendiente === null) {
    return { pares, pendiente: indice }
  }
  const nuevaPareja: [number, number] = pendiente < indice ? [pendiente, indice] : [indice, pendiente]
  return { pares: [...pares, nuevaPareja], pendiente: null }
}

export interface ChipJugador {
  /** Índice sobre la lista YA filtrada — el mismo que entiende `tocarJugador`. */
  indice: number
  nombre: string
}

export interface Chips {
  parejas: Array<{ numero: number; jugadores: ChipJugador[] }>
  sueltos: ChipJugador[]
}

/**
 * Cómo se dibuja la lista de parejas fijas: cada pareja junta y numerada, y
 * aparte los que todavía no tienen.
 *
 * Existe porque pintar todos los chips del mismo color no decía NADA: con 8
 * jugadores se veían 8 chips verdes y ninguna pista de quién quedó con quién,
 * y confirmar que Ana está con Beto y no con Dani obligaba a desarmar las
 * cuatro parejas. El número además le da al lector de pantalla —y a quien no
 * distingue los colores— lo que el color solo no alcanza a decir.
 */
export function agruparChips(nombres: readonly string[], pares: Array<[number, number]>): Chips {
  const emparejados = new Set(pares.flat())
  return {
    parejas: pares.map((par, orden) => ({
      numero: orden + 1,
      jugadores: par.map((indice) => ({ indice, nombre: nombres[indice] ?? '' })),
    })),
    sueltos: nombres
      .map((nombre, indice) => ({ indice, nombre }))
      .filter(({ indice }) => !emparejados.has(indice)),
  }
}
