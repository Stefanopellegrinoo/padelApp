/**
 * El motor puro de un "torneo rápido": una tarde que no toca la base ni
 * Supabase, vive en localStorage (lo guarda la pantalla, en otra work unit).
 * Sin React, sin DOM: sólo TypeScript, para poder testearlo entero acá.
 *
 * Reusa `buildFixture` y `allMatchings` de `core/`, ambas puras e
 * inmodificadas, y las dos entran por el barrel `@/core`. `allMatchings` se
 * exporta ahí a propósito desde el día que la necesitó este módulo: antes era
 * interna de `buildPairs`, y la alternativa —entrar por `@/core/matchings`—
 * era esquivar en silencio el límite que el propio `core/index.ts` declara.
 *
 * OJO con `allMatchings`: tira por arriba de MAX_PLAYERS (12), porque (n-1)!!
 * llega a 654 millones con veinte jugadores. El techo lo pone quien la llama;
 * acá lo pone `armadoWarning`, y `armarRotativas` repite la guarda por si
 * algún día se arma un torneo sin pasar por el aviso.
 */
import { allMatchings, buildFixture, MAX_PLAYERS, type Pair } from '@/core'

// ── El deporte ────────────────────────────────────────────────────────────
export const DEPORTES = ['PADEL', 'PING_PONG'] as const
export type Deporte = (typeof DEPORTES)[number]

export const DEPORTE_LABEL: Record<Deporte, string> = {
  PADEL: 'Pádel',
  PING_PONG: 'Ping pong',
}

/** Sólo el hint del input de puntaje objetivo; no valida nada. */
export const DEPORTE_OBJETIVO: Record<Deporte, number> = {
  PADEL: 4,
  PING_PONG: 11,
}

// ── El armado ────────────────────────────────────────────────────────────
export type Modalidad = 'INDIVIDUAL' | 'PAREJAS'
export type ModoParejas = 'FIJAS' | 'SORTEADAS' | 'ROTATIVAS'

export interface Armado {
  nombre: string
  deporte: Deporte
  modalidad: Modalidad
  /** Se ignora cuando `modalidad === 'INDIVIDUAL'`. */
  modoParejas: ModoParejas
  /** Los nombres tal como se tipearon. Los vacíos se descartan al armar. */
  jugadores: string[]
  /** Sólo ROTATIVAS: cuántas rondas se juegan. */
  rondas: number
  /** Sólo FIJAS: pares de índices sobre `jugadores` ya filtrados. */
  parejasManuales: Array<[number, number]>
}

/** Un partido. `a` y `b` son índices de `Armado.jugadores` (ya filtrado), 1 o 2 por lado. */
export interface Partido {
  ronda: number
  a: number[]
  b: number[]
  /** `null` mientras no se jugó. */
  marcador: { a: number; b: number } | null
}

export interface TorneoRapido {
  armado: Armado
  /** Los nombres ya filtrados y recortados. Los índices de los partidos apuntan ACÁ. */
  jugadores: string[]
  partidos: Partido[]
}

export interface FilaTabla {
  /** Identidad del lado: los índices de sus jugadores, ordenados y unidos por '-'. */
  clave: string
  jugadores: string[]
  jugados: number
  ganados: number
  diferencia: number
  /** 1-based. */
  posicion: number
}

/**
 * Pádel de a dos es el caso más común de un torneo rápido, y SORTEADAS es el
 * modo que menos hay que configurar antes de apretar "Empezar".
 */
export const ARMADO_INICIAL: Armado = {
  nombre: '',
  deporte: 'PADEL',
  modalidad: 'PAREJAS',
  modoParejas: 'SORTEADAS',
  jugadores: [],
  rondas: 4,
  parejasManuales: [],
}

// ── Helpers internos, no exportados ─────────────────────────────────────
function nombresFiltrados(jugadores: readonly string[]): string[] {
  return jugadores.map((nombre) => nombre.trim()).filter((nombre) => nombre.length > 0)
}

/** La identidad de un lado (o de un jugador solo): sus índices, ordenados y unidos. */
function claveLado(indices: readonly number[]): string {
  return [...indices].sort((a, b) => a - b).join('-')
}

/** La spec: de 1 a 12 rondas. Lo exige el aviso del armado Y la lectura del storage. */
const RONDAS_MIN = 1
const RONDAS_MAX = 12

function esRondasValidas(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= RONDAS_MIN &&
    value <= RONDAS_MAX
  )
}

/**
 * Un puntaje válido, para los DOS caminos: el de escritura (`cargarMarcador`)
 * y el de lectura (`leerMarcador`). Antes cada uno tenía su propia idea de qué
 * número aceptar, y el que MENOS exigía era el de lectura — justo el que toca
 * el usuario editando el localStorage a mano. Una regla, un lugar: lo que la
 * app no deja cargar tampoco se puede colar por el storage.
 *
 * `isSafeInteger` y no `isInteger`: arriba de 2^53 la resta de `diferencia`
 * pierde precisión en silencio, y una tabla que ordena mal sin avisar es peor
 * que una que rechaza el dato.
 *
 * Esto estuvo en `isInteger` mientras la pantalla cargaba el marcador con un
 * `type="number"` libre: apretarlo acá habría hecho tirar a `cargarMarcador`
 * en pleno handler de React con un `1e20` tipeado. Ese camino ya no existe —
 * el marcador sale de `marcadorDeDosToques`, acotado a `DEPORTE_OBJETIVO`, así
 * que el techo lo pone la forma de la pantalla y acá sólo se lo hace cumplir.
 * Del lado de la LECTURA sí muerde de verdad, que es el que importa: un
 * `1e308` escrito a mano en el localStorage descarta el torneo entero en vez
 * de coronar a alguien con una diferencia que no se puede ni sumar.
 */
function esPuntajeValido(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * El aviso del "Empezar", o `null` si se puede arrancar. Cuenta sólo los
 * nombres con contenido real: un espacio en blanco no es un jugador.
 */
export function armadoWarning(armado: Armado): string | null {
  const cantidad = nombresFiltrados(armado.jugadores).length

  if (armado.modalidad === 'INDIVIDUAL' && cantidad < 3) {
    return 'Faltan jugadores: individual arranca en 3.'
  }
  if (armado.modalidad === 'PAREJAS' && cantidad < 4) {
    return 'Faltan jugadores: parejas arranca en 4.'
  }

  // El techo es parejo para TODO armado, no sólo para ROTATIVAS: el motivo
  // real es que `allMatchings` (la usa el sorteo americano, más abajo) tira
  // por encima de MAX_PLAYERS, así que el sorteo dejaría de funcionar. Un
  // techo que dependiera del modo sería más confuso que uno solo para todos.
  if (cantidad > MAX_PLAYERS) {
    return `Como mucho ${MAX_PLAYERS} jugadores.`
  }

  if (armado.modalidad === 'PAREJAS') {
    const necesitaPar = armado.modoParejas === 'FIJAS' || armado.modoParejas === 'SORTEADAS'
    if (necesitaPar && cantidad % 2 !== 0) {
      return 'Tiene que ser un número par de jugadores para armar las parejas.'
    }

    if (armado.modoParejas === 'FIJAS') {
      const indices = armado.parejasManuales.flatMap(([a, b]) => [a, b]).sort((x, y) => x - y)
      const esperados = Array.from({ length: cantidad }, (_, i) => i)
      if (JSON.stringify(indices) !== JSON.stringify(esperados)) {
        return 'Asigná una pareja fija a cada jugador, sin repetir a nadie ni dejar a nadie afuera.'
      }
    }

    if (armado.modoParejas === 'ROTATIVAS') {
      if (!esRondasValidas(armado.rondas)) {
        return `Las rondas van de ${RONDAS_MIN} a ${RONDAS_MAX}.`
      }
    }
  }

  return null
}

/** Reparte `fixture` (índices de lado) en partidos, usando `lados` para resolver cada índice. */
function partidosDesdeFixture(
  fixture: Array<Array<[number, number]>>,
  lados: number[][],
): Partido[] {
  const partidos: Partido[] = []
  fixture.forEach((rondaPartidos, indiceRonda) => {
    for (const [li, lj] of rondaPartidos) {
      const ladoA = lados[li]
      const ladoB = lados[lj]
      // Inalcanzable: los índices que da `buildFixture` siempre caen dentro
      // de `lados`. Sólo está para satisfacer noUncheckedIndexedAccess.
      if (ladoA === undefined || ladoB === undefined) continue
      // Copia, no la referencia de `lados`: el mismo lado juega varios
      // partidos y compartir el array haría que mutar uno mutara todos. Nadie
      // muta hoy; la regla de inmutabilidad del repo es que no haya cómo.
      partidos.push({ ronda: indiceRonda + 1, a: [...ladoA], b: [...ladoB], marcador: null })
    }
  })
  return partidos
}

/** Fisher-Yates con el `random` inyectado — nunca `Math.random()`, para que los tests sean deterministas. */
function barajar<T>(items: readonly T[], random: () => number): T[] {
  const copia = [...items]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = copia[i]
    const b = copia[j]
    // Inalcanzable: i y j están siempre dentro de los límites de `copia`.
    if (a === undefined || b === undefined) continue
    copia[i] = b
    copia[j] = a
  }
  return copia
}

/**
 * PAREJAS + ROTATIVAS, el "americano": en cada ronda se reordena por rondas
 * jugadas (menos jugadas primero, así rota quién descansa) y se arma el
 * emparejamiento que menos compañeros repetidos deja, sobre el pool par que
 * resulta de sacar al que sobra cuando la cantidad es impar.
 */
function armarRotativas(armado: Armado, jugadores: string[], random: () => number): TorneoRapido {
  const jugadas = jugadores.map(() => 0)
  const historial = new Set<string>()
  const partidos: Partido[] = []

  for (let ronda = 1; ronda <= armado.rondas; ronda++) {
    const indices = jugadores.map((_, indice) => indice)
    const orden = barajar(indices, random).sort((x, y) => (jugadas[x] ?? 0) - (jugadas[y] ?? 0))

    const tamanioPool = Math.floor(orden.length / 2) * 2
    const pool = orden.slice(0, tamanioPool)

    if (pool.length > MAX_PLAYERS) {
      // Inalcanzable en la práctica: `armadoWarning` frena cualquier armado
      // de más de MAX_PLAYERS jugadores antes de que llegue acá. Guarda
      // explícita porque `allMatchings` tira si esto pasa.
      throw new Error(`El pool de la ronda es demasiado grande: son ${pool.length}.`)
    }

    // ponytail: sorteo greedy por ronda; si repetir compañero molesta de
    // verdad, acá va un diseño de whist
    const candidatos = allMatchings(pool.map(String))
    let mejor: Pair[] | undefined
    let mejorRepetidos = Infinity
    for (const candidato of candidatos) {
      const repetidos = candidato.filter((par) =>
        historial.has(claveLado([Number(par.a), Number(par.b)])),
      ).length
      if (repetidos < mejorRepetidos) {
        mejor = candidato
        mejorRepetidos = repetidos
      }
    }
    // Inalcanzable: un pool par de al menos dos jugadores siempre tiene al
    // menos un emparejamiento posible.
    if (mejor === undefined) continue

    const parejas = mejor.map((par): [number, number] => [Number(par.a), Number(par.b)])

    for (let k = 0; k + 1 < parejas.length; k += 2) {
      const ladoA = parejas[k]
      const ladoB = parejas[k + 1]
      if (ladoA === undefined || ladoB === undefined) continue
      historial.add(claveLado(ladoA))
      historial.add(claveLado(ladoB))
      partidos.push({ ronda, a: ladoA, b: ladoB, marcador: null })
      for (const indice of [...ladoA, ...ladoB]) {
        jugadas[indice] = (jugadas[indice] ?? 0) + 1
      }
    }
    // Si `parejas.length` es impar, la última pareja formada queda sin rival
    // y descansa esa ronda: no entra al loop de a dos de arriba, no suma
    // `jugadas`, y TAMPOCO entra al `historial` — por eso el `add` está
    // adentro del loop y no sobre `parejas`. Anotar una pareja que nunca
    // jugó es contarla como compañeros repetidos sin que lo sean, y el
    // minimizador termina eligiendo una repetición REAL para esquivar esa
    // falsa. Al historial entra sólo lo que se jugó.
  }

  return { armado, jugadores, partidos }
}

/**
 * Construye el torneo. `random` se inyecta (tipo `Math.random`) y nunca se
 * llama `Math.random()` acá adentro: si no, los tests no podrían ser
 * deterministas.
 */
export function armar(armado: Armado, random: () => number): TorneoRapido {
  const jugadores = nombresFiltrados(armado.jugadores)

  if (armado.modalidad === 'INDIVIDUAL') {
    const lados = jugadores.map((_, indice) => [indice])
    const partidos = partidosDesdeFixture(buildFixture(jugadores.length), lados)
    return { armado, jugadores, partidos }
  }

  if (armado.modoParejas === 'FIJAS') {
    const lados = armado.parejasManuales.map(([i, j]) => [i, j])
    const partidos = partidosDesdeFixture(buildFixture(lados.length), lados)
    return { armado, jugadores, partidos }
  }

  if (armado.modoParejas === 'SORTEADAS') {
    const orden = barajar(
      jugadores.map((_, indice) => indice),
      random,
    )
    const lados: number[][] = []
    for (let i = 0; i + 1 < orden.length; i += 2) {
      const uno = orden[i]
      const dos = orden[i + 1]
      // Inalcanzable: `orden` tiene la misma cantidad par de jugadores.
      if (uno === undefined || dos === undefined) continue
      lados.push([uno, dos])
    }
    const partidos = partidosDesdeFixture(buildFixture(lados.length), lados)
    return { armado, jugadores, partidos }
  }

  return armarRotativas(armado, jugadores, random)
}

/**
 * Carga un marcador. Inmutable: devuelve un `TorneoRapido` nuevo, nunca toca
 * el que recibe. Un empate se permite — no todo deporte lo prohíbe.
 */
export function cargarMarcador(
  torneo: TorneoRapido,
  indice: number,
  a: number,
  b: number,
): TorneoRapido {
  const partido = torneo.partidos[indice]
  if (partido === undefined) {
    throw new Error(`No hay ningún partido en la posición ${indice}.`)
  }
  if (!esPuntajeValido(a) || !esPuntajeValido(b)) {
    throw new Error('El marcador tiene que ser un entero mayor o igual a 0.')
  }
  return {
    ...torneo,
    partidos: torneo.partidos.map((p, i) => (i === indice ? { ...p, marcador: { a, b } } : p)),
  }
}

function acumularResultado(
  fila: { jugados: number; ganados: number; diferencia: number },
  propios: number,
  rivales: number,
): void {
  fila.jugados += 1
  fila.diferencia += propios - rivales
  if (propios > rivales) fila.ganados += 1
}

function ordenarFilas(filas: Array<Omit<FilaTabla, 'posicion'>>): FilaTabla[] {
  const ordenadas = [...filas].sort((x, y) => {
    if (y.ganados !== x.ganados) return y.ganados - x.ganados
    if (y.diferencia !== x.diferencia) return y.diferencia - x.diferencia
    // El nombre del lado, para que el orden sea determinístico también en
    // el empate total. Para un lado de dos, el "nombre" es el join de los dos.
    return x.jugadores.join(' y ').localeCompare(y.jugadores.join(' y '), 'es')
  })
  return ordenadas.map((fila, indice) => ({ ...fila, posicion: indice + 1 }))
}

/**
 * La tabla por LADO: cada fila es un lado tal como se armó (una pareja fija,
 * sorteada, o un jugador solo en INDIVIDUAL). Un lado que nunca jugó igual
 * aparece, con ceros — se lo descubre recorriendo TODOS los partidos, no
 * sólo los que ya tienen marcador, porque `armar` los crea a todos de
 * entrada.
 */
function tablaPorLado(torneo: TorneoRapido): FilaTabla[] {
  const nombreDe = (indice: number): string =>
    // Inalcanzable si el torneo es válido: `armar` y `leerTorneo` garantizan
    // que los índices de un partido caen dentro de `jugadores`.
    torneo.jugadores[indice] ?? `#${indice}`

  const filas = new Map<
    string,
    { jugadores: string[]; jugados: number; ganados: number; diferencia: number }
  >()

  const asegurarLado = (indices: number[]): void => {
    const clave = claveLado(indices)
    if (!filas.has(clave)) {
      filas.set(clave, { jugadores: indices.map(nombreDe), jugados: 0, ganados: 0, diferencia: 0 })
    }
  }
  for (const partido of torneo.partidos) {
    asegurarLado(partido.a)
    asegurarLado(partido.b)
  }

  for (const partido of torneo.partidos) {
    if (partido.marcador === null) continue
    const filaA = filas.get(claveLado(partido.a))
    const filaB = filas.get(claveLado(partido.b))
    // Inalcanzable: los dos lados de todo partido se registraron arriba.
    if (filaA === undefined || filaB === undefined) continue
    acumularResultado(filaA, partido.marcador.a, partido.marcador.b)
    acumularResultado(filaB, partido.marcador.b, partido.marcador.a)
  }

  return ordenarFilas([...filas.entries()].map(([clave, fila]) => ({ clave, ...fila })))
}

/**
 * La tabla POR JUGADOR: sólo para PAREJAS + ROTATIVAS, porque ahí el lado
 * cambia de ronda en ronda y lo que importa es la persona, no la pareja de
 * turno.
 */
function tablaPorJugador(torneo: TorneoRapido): FilaTabla[] {
  const filas = torneo.jugadores.map((nombre, indice) => ({
    clave: claveLado([indice]),
    jugadores: [nombre],
    jugados: 0,
    ganados: 0,
    diferencia: 0,
  }))

  for (const partido of torneo.partidos) {
    if (partido.marcador === null) continue
    for (const indice of partido.a) {
      const fila = filas[indice]
      if (fila !== undefined) acumularResultado(fila, partido.marcador.a, partido.marcador.b)
    }
    for (const indice of partido.b) {
      const fila = filas[indice]
      if (fila !== undefined) acumularResultado(fila, partido.marcador.b, partido.marcador.a)
    }
  }

  return ordenarFilas(filas)
}

export function tabla(torneo: TorneoRapido): FilaTabla[] {
  if (torneo.armado.modalidad === 'PAREJAS' && torneo.armado.modoParejas === 'ROTATIVAS') {
    return tablaPorJugador(torneo)
  }
  return tablaPorLado(torneo)
}

export function terminado(torneo: TorneoRapido): boolean {
  return torneo.partidos.every((partido) => partido.marcador !== null)
}

export function campeon(torneo: TorneoRapido): FilaTabla | null {
  if (!terminado(torneo)) return null
  const filas = tabla(torneo)
  return filas.find((fila) => fila.posicion === 1) ?? null
}

export const STORAGE_KEY = 'padel:torneo-rapido'

// ── Leer desde localStorage: el único borde de confianza del módulo ──────
// `raw` lo puede haber editado el usuario a mano, o venir de una versión
// vieja de la app. Nada de castear: cada campo se valida por su cuenta, y
// cualquier cosa rara devuelve `null` en vez de tirar.

function esString(value: unknown): value is string {
  return typeof value === 'string'
}

function esNumeroFinito(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function esArrayDeStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(esString)
}

function esArrayDeNumeros(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(esNumeroFinito)
}

function esParDeIndices(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && esNumeroFinito(value[0]) && esNumeroFinito(value[1])
}

function esDeporte(value: unknown): value is Deporte {
  return typeof value === 'string' && (DEPORTES as readonly string[]).includes(value)
}

function esModalidad(value: unknown): value is Modalidad {
  return value === 'INDIVIDUAL' || value === 'PAREJAS'
}

function esModoParejas(value: unknown): value is ModoParejas {
  return value === 'FIJAS' || value === 'SORTEADAS' || value === 'ROTATIVAS'
}

function leerArmado(value: unknown): Armado | null {
  if (typeof value !== 'object' || value === null) return null
  const candidato = value as Record<string, unknown>

  if (!esString(candidato.nombre)) return null
  if (!esDeporte(candidato.deporte)) return null
  if (!esModalidad(candidato.modalidad)) return null
  if (!esModoParejas(candidato.modoParejas)) return null
  if (!esArrayDeStrings(candidato.jugadores)) return null
  if (!esRondasValidas(candidato.rondas)) return null
  if (!Array.isArray(candidato.parejasManuales)) return null

  // Los índices de `parejasManuales` apuntan a los jugadores YA filtrados
  // (ver el comentario del campo en `Armado`), no a la lista cruda.
  const cantidadFiltrada = nombresFiltrados(candidato.jugadores).length
  const dentroDeRango = (indice: number) =>
    Number.isInteger(indice) && indice >= 0 && indice < cantidadFiltrada

  const parejasManuales: Array<[number, number]> = []
  for (const par of candidato.parejasManuales) {
    if (!esParDeIndices(par)) return null
    if (!dentroDeRango(par[0]) || !dentroDeRango(par[1])) return null
    parejasManuales.push(par)
  }

  return {
    nombre: candidato.nombre,
    deporte: candidato.deporte,
    modalidad: candidato.modalidad,
    modoParejas: candidato.modoParejas,
    jugadores: candidato.jugadores,
    rondas: candidato.rondas,
    parejasManuales,
  }
}

function leerMarcador(value: unknown): { a: number; b: number } | null | undefined {
  if (value === null) return null
  if (typeof value !== 'object') return undefined
  const candidato = value as Record<string, unknown>
  if (!esPuntajeValido(candidato.a) || !esPuntajeValido(candidato.b)) return undefined
  return { a: candidato.a, b: candidato.b }
}

function leerPartido(value: unknown, cantidadJugadores: number): Partido | null {
  if (typeof value !== 'object' || value === null) return null
  const candidato = value as Record<string, unknown>

  if (!esNumeroFinito(candidato.ronda)) return null
  if (!esArrayDeNumeros(candidato.a) || (candidato.a.length !== 1 && candidato.a.length !== 2)) return null
  if (!esArrayDeNumeros(candidato.b) || (candidato.b.length !== 1 && candidato.b.length !== 2)) return null

  const dentroDeRango = (indices: number[]) =>
    indices.every((indice) => Number.isInteger(indice) && indice >= 0 && indice < cantidadJugadores)
  if (!dentroDeRango(candidato.a) || !dentroDeRango(candidato.b)) return null

  // Un partido es dos lados del MISMO tamaño y sin un solo jugador en común:
  // nadie juega contra sí mismo ni de compañero de sí mismo. Sin esto,
  // `tabla` le cuenta `jugados: 2` a un jugador que aparece de los dos lados
  // de una sola fila, porque `acumularResultado` corre dos veces sobre ella.
  if (candidato.a.length !== candidato.b.length) return null
  const enCancha = [...candidato.a, ...candidato.b]
  if (new Set(enCancha).size !== enCancha.length) return null

  const marcador = leerMarcador(candidato.marcador)
  if (marcador === undefined) return null

  return { ronda: candidato.ronda, a: candidato.a, b: candidato.b, marcador }
}

function validarTorneo(data: unknown): TorneoRapido | null {
  if (typeof data !== 'object' || data === null) return null
  const candidato = data as Record<string, unknown>

  const armado = leerArmado(candidato.armado)
  if (armado === null) return null

  if (!esArrayDeStrings(candidato.jugadores)) return null
  const jugadores = candidato.jugadores

  if (!Array.isArray(candidato.partidos)) return null
  const partidos: Partido[] = []
  for (const item of candidato.partidos) {
    const partido = leerPartido(item, jugadores.length)
    if (partido === null) return null
    partidos.push(partido)
  }

  return { armado, jugadores, partidos }
}

export function leerTorneo(raw: string | null): TorneoRapido | null {
  if (raw === null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  return validarTorneo(data)
}

export function escribirTorneo(torneo: TorneoRapido): string {
  return JSON.stringify(torneo)
}
