/**
 * The public surface of `core/`.
 *
 * Everything the rest of the app is meant to use goes through here. Importing
 * a deep path like `core/pairing` still works — TypeScript cannot forbid it —
 * but this file is the declared boundary, and anything missing from it is an
 * implementation detail that may change without warning.
 *
 * `core/` is pure: no database, no network, no framework, and no `Date`,
 * `Math.random`, `fetch` or `process` anywhere. Every function takes data and
 * returns data. That is what lets a closed matchday be recomputed months later
 * and come out exactly as it did the night it was played.
 */

// ── The format's fixed limits ────────────────────────────────────────────────
// Not configuration. A matchday below MIN_PLAYERS is lopsided, above
// MAX_PLAYERS does not fit an afternoon, and the Masters' three rotating
// matches exist because there are exactly four players.
export { MIN_PLAYERS, MAX_PLAYERS, MASTERS_SIZE, MASTERS_MATCHES } from './constants'

//── El slug de una disciplina en la URL (PR 10, REQ-NR-5) ────────────────────
// Derivado, no persistido: no hay columna `slug`.
export type { SluggableDiscipline } from './discipline-slug'
export { disciplineSlugs, resolveDisciplineBySlug } from './discipline-slug'

// ── Domain types ─────────────────────────────────────────────────────────────
// `EntryId` is a seat in a season, never a player. Matches reference the seat,
// so claiming a profile is one update and the tournament's history is untouched.
export type {
  EntryId,
  DisciplineId,
  MatchFormat,
  SeasonConfig,
  SideSize,
  Side,
  SetScore,
  Phase,
  MatchdayFormat,
  MatchResult,
  SideStanding,
  Award,
  RankingRow,
} from './types'
// `PHASE_ORDER` sale del barrel para su test estructural
// (`db/match-phase.db.test.ts`): las seis fases están escritas también en el
// `check` de `matches.fase` y en el `array_position` de `matchday_phase`
// (0039_match_phase.sql) — sin un test que las ate, las tres pueden driftear
// en silencio.
export { PHASE_ORDER } from './types'

//── Un lado de 1 o 2 (decisión de producto #5, REQ-D5-1/2) ──────────────────
// `Side` es una unión discriminada: leer `.b` sin angostar `size` a `2` es
// error de compilación. **PR19 borró `Pair`, `sideOf`, `pairOf` y
// `core/pair-compat.ts` enteros**: ya no hay adaptador ni tipo paralelo, y
// `Side` es la única forma de nombrar un lado en todo el repo.
export { single, pair, members, includes, partnerOf, sameSide, sideOfRow } from './side'

// ── Season configuration ─────────────────────────────────────────────────────
// `validateConfig` RETURNS its problems in Spanish, it never throws — so it
// only protects callers who actually read the result. Call it at every edge.
// Skipping it is not merely untidy: `tiebreakSnapshotEvery: 0` makes the
// snapshot chain loop forever.
// `disciplineProfile` es la ÚNICA fuente de "con qué marcador nace una
// disciplina de este tipo": la usan los dos caminos que crean una (el wizard y
// "+ Agregar disciplina" de Ajustes), que antes armaban los dos su config con
// `defaultConfig` y hacían nacer una liga de FIFA siendo pádel con otro nombre.
export { validateConfig, defaultConfig, disciplineProfile, pointsErrors } from './config'

// ── Building a matchday ──────────────────────────────────────────────────────
// `buildSides` (PR16, design PUNTO 5) is the Side-native entry point: with
// `sideSize=2` it is `buildPairs`, que desde PR19 ya devuelve `Side[]` solo.
// `buildPairs`/`PairingInput` stay exported for `core/`-internal callers and
//Tests (`buildSides` itself, `core/pairing.test.ts`) — N27 (
// ronda 12): `db/matchday.ts` no llama `buildPairs` directo desde PR18a, sólo
// `buildSides`/`type PairingInput`.
export type { PairingInput, SideBuildInput } from './pairing'
export { buildPairs, buildSides } from './pairing'
export { buildFixture } from './fixture'

// ── El contexto que hereda una fecha de las anteriores ───────────────────────
// Quién defiende no se guarda nunca (spec 3.3): se deriva de las dos fechas
// previas, acá adentro y no en la capa de datos.
export type { MatchdayHistory, PreviousContext } from './history'
export { previousContext } from './history'

// ── Scoring a matchday ───────────────────────────────────────────────────────
// `usesSetsDiff` sale a la superficie porque el criterio lo comparten tres
// lugares —la tabla, la frase del desempate de la fecha y la página de Reglas—
// y eran tres copias de `setsToWin > 1`. Arreglar una sola las hacía discrepar.
export { computeStandings, usesSetsDiff } from './standings'
export { computeAwards } from './awards'

//── Formato sugerido y grupos de una fecha (REQ-D8-1, PR21) ─────────────────
// `suggestFormat` es la salida real de W32 (decisión #3863): grupos + llave
// en vez de un techo de jugadores nuevo. `MatchdayFormat` (su tipo de
// retorno, exportado arriba desde `./types`) SALE del barrel recién en esta
// rebanada (C1): `generatePairs` (`db/matchday.ts`) ya lo lee de
// `matchday.formato` para decidir cómo armar — es su primer consumidor real,
// publicarlo deja de ser reflejo. `groupSides` sale con él por el mismo
// motivo: es el helper que `generatePairs` usa para repartir los lados antes
// de llamar `buildFixture` una vez por grupo (hallazgo de diseño de esta
// rebanada, el design PUNTO 7 no lo nombraba). Rebanada C2: `currentPhase`/
// `phaseIsComplete`/`faseForCount`/`knockoutMatchups`/`nextRoundMatchups`/
// `losingMatchup` salen ahora — `advancePhase` (`db/matchday.ts`) es su
// primer consumidor real. Rebanada D1: `knockoutPositions` sale ahora —
// `closeMatchday` (`db/matchday.ts`, `standingsFromBracket`) es su primer
// consumidor de producción real.
export {
  suggestFormat,
  groupSides,
  currentPhase,
  phaseIsComplete,
  faseForCount,
  knockoutMatchups,
  nextRoundMatchups,
  losingMatchup,
  knockoutPositions,
} from './knockout'

// ── The season ───────────────────────────────────────────────────────────────
export { computeRanking } from './ranking'
export { snapshotForMatchday } from './snapshots'

//── La tabla global (REQ-D9-1/2): suma ponderada de cada disciplina ─────────
export type { DisciplineRanking, GlobalRankingRow } from './global-ranking'
export { computeGlobalRanking } from './global-ranking'

// El estado real de un torneo con más de una disciplina: DERIVADO, nunca
// leído de una sola columna. `seasons.status` sigue en dual-write hasta el
// contract (PR 27).
export type { SeasonStatus } from './season'
export { seasonStatusOf } from './season'

// ── The Masters ──────────────────────────────────────────────────────────────
export type { MastersFour } from './masters'
export { mastersQualifiers, mastersFixture, mastersChampion } from './masters'

// ── The rules page ───────────────────────────────────────────────────────────
// Generated from the config, so it can never disagree with what the app does.
export type { RulesSection } from './narrate'
// `formatLabel` NO sale del barrel (S77): narra UNA disciplina, y quedó sin un
// solo consumidor de `app/` cuando las tres pantallas pasaron a `formatsLabel`
// al cerrar W64. Publicarla es dejar abierta la puerta por la que se entra a
// narrar un torneo de dos formatos con uno solo — que es literalmente lo que
// fue W64. Sigue exportada de `./narrate`, para su test y para `formatsLabel`,
// que es su único llamador.
export { formatsLabel, narrateRules, scoreDiffLabel, scoreUnit } from './narrate'
// `thirdPlaceNote` (decisión #3990, PR21 D2): la fecha de la [id]/[disciplina]/
// fechas/[n]/page.tsx CERRADA es su primer consumidor real.
export { thirdPlaceNote } from './narrate'

// ── Reading the season back ──────────────────────────────────────────────────
// What the read-only screens need on top of the ranking. All derived, nothing
// stored: recomputing is cheap and deterministic, and a stored position would
// drift the first time somebody reopens a matchday.

// Per PLAYER, not per pair: a champion pair plays exactly two matchdays
// together (spec 2.5), so its streak could only ever be 0 or 1.
export type { Streak } from './streak'
export { titleStreaks } from './streak'

// `movement` is null when there is nothing to compare against and 0 when the
// player did not move. The screen draws those two differently.
export type { RankedRow } from './movement'
export { rankingWithMovement } from './movement'

// Counts only. The percentages are the screen's job, which also keeps the
// divide-by-zero decision out of here.
export type { PlayedMatchday, PartnerRecord, PlayerTally } from './playerstats'
export { tallyPlayers, partnerRecords, bestPair } from './playerstats'

/*
 * Deliberately NOT exported — internal to the modules above:
 *
 *   allMatchings   (matchings.ts)   enumerates every way to split a pool into
 *                                   pairs. Only buildPairs needs it, and it
 *                                   throws above MAX_PLAYERS because (n-1)!!
 *                                   reaches 654 million at twenty players.
 *   orderByPoints  (order.ts)       sorts by points with the snapshot as
 *                                   tiebreak. Callers want computeRanking,
 *                                   which returns rows already in order.
 */
