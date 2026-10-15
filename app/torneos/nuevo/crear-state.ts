import {
  fichaSeed,
  modalityShape,
  shuffled,
  sportLabel,
  sportOf,
  type FirstFecha,
  type Modality,
  type ReglamentoInput,
  type SeasonConfig,
  type SideSize,
  type TournamentSport,
} from '@/core'
import type { NewSeasonDiscipline } from '@/db/season'
import { rulesFromSeed, type DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import type { PrimeraFecha } from '@/app/deporte/tarjeta-state'
import { effectiveFloor, resizeConfig, squadWarning, submitSeats, type Squad } from './wizard-state'

/**
 * Un deporte elegido en el wizard nuevo (pasos 1 y 3): la ficha copiada más lo que el usuario fue tocando.
 * `primeraFecha` manda: el `config.firstFecha` de `rules` es el de la ficha y `crearPayload` lo pisa.
 */
export interface DeporteElegido {
  kind: TournamentSport
  modality: Modality
  /** `igualQue` = otro `TournamentSport` elegido. */
  primeraFecha: PrimeraFecha
  rules: DisciplineRules
  /** Índices sobre `submitSeats(squad).squadNames`. Con FIJAS, índices de PAREJA (sobre `pairs`). Vacío = orden del plantel. */
  order: number[]
  /** Sólo FIJAS. Índices sobre `squadNames`. */
  pairs: Array<[number, number]>
}

const isIgualQue = (value: PrimeraFecha): value is { igualQue: string } => typeof value !== 'string'

/** Una tarjeta recién sacada de la ficha: la ÚNICA lectura de la ficha de este módulo. */
function cardFromFicha(kind: TournamentSport, modality: Modality, squadSize: number): DeporteElegido {
  const seed = fichaSeed(kind, squadSize, modality)
  return { kind, modality, primeraFecha: seed.config.firstFecha ?? 'SORTEO', rules: rulesFromSeed(seed), order: [], pairs: [] }
}

const mapCard = (cards: readonly DeporteElegido[], kind: TournamentSport, patch: (card: DeporteElegido) => DeporteElegido) =>
  cards.map((card) => (card.kind === kind ? patch(card) : card))

/** Toca un chip: agrega la tarjeta (ficha, primera modalidad) al final, o la saca (y quien era "igual que" ella vuelve a su default). */
export function elegirDeporte(cards: readonly DeporteElegido[], kind: TournamentSport, squadSize: number): DeporteElegido[] {
  if (!cards.some((card) => card.kind === kind)) {
    const modality = sportOf(kind).ficha?.modalities[0]?.id
    if (modality === undefined) throw new Error(`${kind} no se juega en torneos.`)
    return [...cards, cardFromFicha(kind, modality, squadSize)]
  }
  return cards
    .filter((card) => card.kind !== kind)
    .map((card) =>
      isIgualQue(card.primeraFecha) && card.primeraFecha.igualQue === kind
        ? { ...card, primeraFecha: cardFromFicha(card.kind, card.modality, squadSize).primeraFecha }
        : card,
    )
}

/** Reaplica de la ficha lo que depende de la modalidad: puntos, Masters, primera fecha. Lo demás que el usuario tocó se queda. Vacía order y pairs. */
export function cambiarModalidad(card: DeporteElegido, modality: Modality, squadSize: number): DeporteElegido {
  const fresh = cardFromFicha(card.kind, modality, squadSize)
  return {
    ...card,
    modality,
    primeraFecha: fresh.primeraFecha,
    rules: {
      ...card.rules,
      config: { ...card.rules.config, points: fresh.rules.config.points, firstFecha: fresh.rules.config.firstFecha },
      hasMasters: fresh.rules.hasMasters,
    },
    order: [],
    pairs: [],
  }
}

export function opcionesPrimeraFecha(
  cards: readonly DeporteElegido[],
  kind: TournamentSport,
): { value: PrimeraFecha; label: string; sub: string | null }[] {
  // Sin cadenas: sólo se copia a una tarjeta que tenga su propio orden, y a la que otra copia no copia a nadie.
  const copiada = cards.some((card) => isIgualQue(card.primeraFecha) && card.primeraFecha.igualQue === kind)
  const igualQue = copiada
    ? []
    : cards
        .filter((card) => card.kind !== kind && !isIgualQue(card.primeraFecha))
        .map((card) => ({ value: { igualQue: card.kind }, label: `Igual que ${sportLabel(card.kind)}`, sub: null }))
  return [
    { value: 'NIVEL', label: 'Por nivel', sub: 'las ordenás vos' },
    { value: 'SORTEO', label: 'Al azar', sub: 'sorteo' },
    ...igualQue,
  ]
}

export function cambiarPrimeraFecha(cards: readonly DeporteElegido[], kind: TournamentSport, value: PrimeraFecha): DeporteElegido[] {
  return mapCard(cards, kind, (card) => ({ ...card, primeraFecha: value }))
}

export function cambiarReglas(cards: readonly DeporteElegido[], kind: TournamentSport, rules: DisciplineRules): DeporteElegido[] {
  return mapCard(cards, kind, (card) => ({ ...card, rules }))
}

/** "Volver a las reglas de X". */
export function reglasDeFicha(card: DeporteElegido, squadSize: number): DisciplineRules {
  return cardFromFicha(card.kind, card.modality, squadSize).rules
}

const sideSizeOf = (card: DeporteElegido): SideSize => modalityShape(card.modality).pairSize

/** El plantel cambió: puntos al tamaño nuevo (`resizeConfig`) y order/pairs vacíos en todas. */
export function plantelCambio(cards: readonly DeporteElegido[], squadSize: number): DeporteElegido[] {
  return cards.map((card) => ({
    ...card,
    rules: { ...card.rules, config: resizeConfig(card.rules.config, squadSize, sideSizeOf(card)) },
    order: [],
    pairs: [],
  }))
}

/** Aviso del paso 3 (texto de `squadWarning`), o null: plantel impar con alguna modalidad de parejas, o corto para el piso que piden. */
export function errorDeModalidades(cards: readonly DeporteElegido[], names: readonly string[]): string | null {
  // Con el piso de las modalidades de AHORA: pasar a parejas en el paso 3 lo sube después del paso 2.
  const sideSizes = cards.map(sideSizeOf)
  return squadWarning(names, effectiveFloor(sideSizes), sideSizes.includes(2))
}

export type Subpaso = 'PAREJAS' | 'NIVEL'

/** PAREJAS si alguna es FIJAS; NIVEL si alguna va por nivel; en ese orden. */
export function subpasos(cards: readonly DeporteElegido[]): Subpaso[] {
  const needed: Array<[Subpaso, boolean]> = [
    ['PAREJAS', cards.some((card) => card.modality === 'FIJAS')],
    ['NIVEL', cards.some((card) => card.primeraFecha === 'NIVEL')],
  ]
  return needed.filter(([, isNeeded]) => isNeeded).map(([subpaso]) => subpaso)
}

/** Shuffled + de a dos: índices de asiento. */
export function sortearParejas(seats: number, random: () => number): Array<[number, number]> {
  if (seats % 2 !== 0) throw new Error('Sortear parejas necesita un plantel par.')
  const order = shuffled(Array.from({ length: seats }, (_, at) => at), random)
  return Array.from({ length: seats / 2 }, (_, pair) => [order[2 * pair]!, order[2 * pair + 1]!])
}

/** "Sortear parejas": sortea a los sueltos y deja las armadas a mano; con todas armadas, sortea todo de nuevo. */
export function tocarSortear(pairs: Array<[number, number]>, seats: number, random: () => number): Array<[number, number]> {
  const paired = new Set(pairs.flat())
  const loose = Array.from({ length: seats }, (_, at) => at).filter((at) => !paired.has(at))
  if (loose.length === 0) return sortearParejas(seats, random)
  return [...pairs, ...sortearParejas(loose.length, random).map(([a, b]): [number, number] => [loose[a]!, loose[b]!])]
}

/** Las parejas de esa tarjeta, rearmadas (tocar, sortear, deshacer): su orden era de parejas y ya no significa nada. */
export function cambiarParejas(
  cards: readonly DeporteElegido[],
  kind: TournamentSport,
  pairs: Array<[number, number]>,
): DeporteElegido[] {
  return mapCard(cards, kind, (card) => ({ ...card, pairs, order: [] }))
}

/** "Mejor que lo sortee la app": las que iban por nivel pasan a al azar (las "igual que" las siguen solas). */
export function sorteaLaApp(cards: readonly DeporteElegido[]): DeporteElegido[] {
  return cards.map((card) => (card.primeraFecha === 'NIVEL' ? { ...card, primeraFecha: 'SORTEO' } : card))
}

/** El orden que se muestra para ordenar: el armado o, vacío, el del plantel (de personas, o de parejas con FIJAS). */
export function ordenInicial(card: DeporteElegido, seats: number): number[] {
  if (card.order.length > 0) return [...card.order]
  return Array.from({ length: card.modality === 'FIJAS' ? card.pairs.length : seats }, (_, at) => at)
}

/** Mueve (no intercambia): saca el de `from` y lo pone en `to`. Para el arrastre y para ↑/↓. */
export function moverEnOrden(order: readonly number[], from: number, to: number): number[] {
  const next = order.filter((_, at) => at !== from)
  next.splice(to, 0, order[from]!)
  return next
}

/** Arrastre: el lugar de la fila `from` soltada en `y` = cuántas de las otras tienen la mitad más arriba (alturas medidas al agarrarla). */
export function filaDestino(rows: readonly { top: number; height: number }[], from: number, y: number): number {
  return rows.filter((row, at) => at !== from && row.top + row.height / 2 < y).length
}

/** Con FIJAS, cada asiento en una sola pareja. Sin parejas fijas no hay nada que armar. */
export function parejasCompletas(card: DeporteElegido, seats: number): boolean {
  if (card.modality !== 'FIJAS') return true
  const members = card.pairs.flat()
  return members.length === seats && new Set(members).size === seats && members.every((at) => Number.isInteger(at) && at >= 0 && at < seats)
}

/** El orden de una tarjeta por nivel: con FIJAS el orden es de parejas, y a la base le llega aplanado. */
function seedOrderOf(card: DeporteElegido): number[] {
  return card.modality === 'FIJAS' ? card.order.flatMap((pair) => card.pairs[pair] ?? []) : [...card.order]
}

/** El modo de la primera fecha (el de la otra tarjeta si copia) y cómo se manda el orden. */
function primeraFechaOf(
  card: DeporteElegido,
  cards: readonly DeporteElegido[],
): { firstFecha: FirstFecha; order: Pick<NewSeasonDiscipline, 'seedOrder' | 'shuffle' | 'sameOrderAs'> } {
  if (isIgualQue(card.primeraFecha)) {
    const { igualQue } = card.primeraFecha
    const at = cards.findIndex((other) => other.kind === igualQue)
    const target = cards[at]
    if (target === undefined || isIgualQue(target.primeraFecha)) {
      throw new Error('"Igual que" tiene que apuntar a otro deporte del torneo.')
    }
    return { firstFecha: target.primeraFecha, order: { sameOrderAs: at } }
  }
  if (card.primeraFecha === 'SORTEO') return { firstFecha: 'SORTEO', order: { shuffle: true } }
  return { firstFecha: 'NIVEL', order: card.order.length === 0 ? {} : { seedOrder: seedOrderOf(card) } }
}

/** Lo que se manda a crear, con todo lo que `reglamento` necesita para contarlo (el paso 4 cuenta esto mismo). */
type DisciplinaACrear = NewSeasonDiscipline & ReglamentoInput

function disciplineOf(card: DeporteElegido, cards: readonly DeporteElegido[], squadSize: number): DisciplinaACrear {
  const { pairSize, fixedTeams } = modalityShape(card.modality)
  const { firstFecha, order } = primeraFechaOf(card, cards)
  return {
    kind: card.kind,
    config: { ...resizeConfig(card.rules.config, squadSize, pairSize), firstFecha },
    pairSize,
    fixedTeams,
    allowsDraw: sportOf(card.kind).allowsDraw,
    hasMasters: pairSize === 2 && card.rules.hasMasters,
    formatoDefault: card.rules.formatoDefault,
    ...order,
    ...(fixedTeams && card.pairs.length > 0 ? { teams: card.pairs.map(([a, b]): [number, number] => [a, b]) } : {}),
  }
}

/** El input de `createTournament`. `config` (legado de `NewSeason`) es la de la primera tarjeta. */
export function crearPayload(
  name: string,
  squad: Squad,
  cards: readonly DeporteElegido[],
): { name: string; squadNames: string[]; mySeatIndex: number | null; config: SeasonConfig; disciplines: DisciplinaACrear[] } {
  if (cards.length === 0) throw new Error('Elegí al menos un deporte.')
  const { squadNames, mySeatIndex } = submitSeats(squad)
  const disciplines = cards.map((card) => disciplineOf(card, cards, squadNames.length))
  return { name, squadNames, mySeatIndex, config: disciplines[0]!.config, disciplines }
}
