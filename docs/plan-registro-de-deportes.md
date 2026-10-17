# Registro de deportes — Fase 1 (amigos sobre el registro, torneo igual)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⚠ Leer antes de ejecutar
>
> **`0072`/`0090`–`0092` YA ESTÁN PUSHEADAS** (`integracion/multi-disciplina-con-rapidos`
> en `origin`). NO se reescriben: el cambio de esquema es una migración nueva,
> **`0093`**. Antes de la Tarea 3: `ls supabase/migrations | tail -1` → tiene que
> ser `0092_save_casual_match.sql`; si hay una `0093`, renumerar.
>
> **Toda base local necesita `npm run db:reset`** después de la Tarea 3. Nada de
> esto toca una base remota.
>
> El dueño pidió: *"con mucho cuidado, sin romper nada; la idea es mejorar el
> producto"*. Cada tarea deja el torneo, `/rapido` y lo ya cargado en amigos
> exactamente como estaban; los tests de torneo y de rápido NO se editan.

**Goal:** Muchos deportes, cada uno con su info, y sumar uno de una familia que
ya existe es UNA entrada de un registro. El partido casual de amigos deja de
preguntar `=== 'PADEL'` / `=== 'FIFA'` y pregunta por la **familia** del deporte.

**Architecture:** Dos capas, nada más.
1. **El deporte es DATO:** `core/sports.ts` — `SPORTS: Record<SportId, Sport>`
   con `label`, `unit`, `family`, `allowsDraw`, `tournaments` y lo propio de la
   familia (formato y rangos para `sets`; `teams` para `goals`).
2. **La familia es la estrategia:** dos familias, `sets` y `goals`. Cada una es
   dueña de (a) parsear/validar el resultado (`parseSetsResult` /
   `parseGoalsResult` en `db/friends.ts`, sobre `matchError` de
   `db/validate.ts` — no hay segundo validador), (b) su pedazo de formulario
   (`resultado-sets.tsx` / `resultado-goles.tsx`) y (c) su display (pastillas
   por set / un número — `Marcador` ya decide por datos, no por deporte).

La base deja de saber qué deportes existen (opción B del dueño): `0093` saca el
CHECK de la lista y las dos constraints con nombre de deporte, y pone un
invariante genérico de FORMA de id. El único camino de escritura
(`parseCasualResult` → registro → familia) es el que sabe.

**Tech Stack:** Next.js 15, React 19, TS 5.7 strict, Supabase (RLS), Tailwind v4, vitest.

## Decisiones tomadas (no se re-discuten)

| tema | decisión | por qué |
|---|---|---|
| dónde vive el registro | `core/sports.ts` (+ `core/sports.test.ts`, convención de `core/`), re-exportado por `core/index.ts` | `core/` es la capa de abajo: `db/` y `app/` ya importan de `@/core`. `core/` NO importa `db/`, así que el registro es SÓLO dato + helpers puros; la validación por familia vive en `db/friends.ts` (necesita `matchError`/`EdgeError`, que están en `db/`). |
| ids | strings en MAYÚSCULA, los mismos de hoy: `PADEL`, `FIFA`; nuevos `FUTBOL`, `BASQUET`, `PING_PONG` | las filas guardadas (`'PADEL'`/`'FIFA'`) siguen valiendo sin backfill. |
| torneo | `DISCIPLINE_KINDS`/`DisciplineKind`/`DISCIPLINE_LABELS`/`disciplineProfile` pasan a DERIVARSE del registro con el MISMO tipo (`readonly ['PADEL','FIFA']`) y los mismos valores | `disciplines.kind` sigue con su CHECK en Fase 1, y `wizard.tsx` tiene `Record<DisciplineKind, …>` literales (`:796-882`) que no compilarían con un tipo más ancho. Un test ata la tupla a `tournaments: true` del registro. |
| tenis | **AFUERA de Fase 1** | el 7-6 no entra en ninguna regla de `setError` (`db/validate.ts:47-90`): con `tieBreak: true` el ganador llega EXACTO a `gamesPerSet` (rechaza 7-5); con `false` hay que ganar por dos (rechaza 7-6). Una tercera regla necesita un campo en `MatchFormat` (`core/types.ts:19`), y la casa prohíbe campos nuevos opcionales con default permisivo ahí (#3933, JSDoc de `openScore`): obligatorio = tocar CADA literal de `MatchFormat`, incluidos los tests de torneo y los jsonb de config guardados. Además la máquina de dos toques asume ganador = `gamesPerSet`. Es Fase 2, junto con el torneo. |
| vóley | **AFUERA** | el 5º set va a 15 (un solo `gamesPerSet` no lo describe) y un set a 25 en dos toques son 24+ botones. Necesita carga tipeada por set: Fase 2. |
| ping pong | familia `sets`, regla existente `tieBreak: false` (gana por dos: `11-9`, `12-10` ya pasan `setError`), `gamesPerSet` FIJO en 11 (sin stepper), `unit: 'puntos'` | encaja honesto en la regla de hoy. Lo único que falta es CARGAR el deuce en dos toques: botones extra en amigos (`deuceOptions`, Tarea 6b), sin tocar `carga-state.ts` (lo usan torneo y `/rapido`). |
| básquet | familia `goals`, `allowsDraw: false`, `unit: 'puntos'` | hoy el casual de goles hardcodea el empate (`matchError(..., true)`, `db/friends.ts:871`); la familia pasa a usar `sport.allowsDraw` y el radio "Empataron" sólo se dibuja si el deporte lo admite. |
| unidad | `unit` por deporte: `'games'` / `'puntos'` / `'goles'` → copy "Games por set", "¿Cuántos puntos hizo el que perdió?", "Goles de tu lado" | con `unit` de pádel = `'games'` y de FIFA = `'goles'` TODO el copy actual sale idéntico (los tests de `cargar` no se tocan). |
| equipos | `teams: boolean` sólo en `goals`; `true` sólo FIFA | "con qué club jugaste" es de un videojuego; en fútbol real los equipos son los jugadores. |
| base | `0093`: `drop` de `casual_matches_sport_check`, `casual_teams_fifa`, `casual_padel_shape`; `add constraint casual_sport_id check (sport ~ '^[A-Z][A-Z_]{0,31}$')`. Nada más. | opción B. El único invariante que se puede decir sin nombrar deportes es la forma del id (mayúscula, acotado). Las formas por familia (sets ⇒ sin goles y con ganador) cruzan tablas o nombran deportes: las valida el único camino de escritura. `casual_score_pair`, `casual_sets_no_draw` y los checks de equipo no vacío siguen (son genéricos). |
| lectura de un id desconocido | `CasualMatch.sport: string` (ya no hay CHECK que respalde un cast); `sportLabel(id)` = `SPORTS[id]?.label ?? id`; familia = la del registro o, si no la hay, `'sets'` si el partido tiene filas en `casual_match_sets`, si no `'goals'`. Nunca tira. | una fila escrita antes de sacar un deporte del registro, o a mano por la RPC, no puede tumbar el historial de nadie. Editarla obliga a elegir un deporte de la lista. |
| sets en la lectura | `historyWith` pide `casual_match_sets` para TODOS los casuales (no sólo `PADEL`) | un `.in()` menos condicional y es lo que hace funcionar el fallback de arriba. Cuesta una consulta más en un historial sólo-goles. |

## Lista inicial de deportes (Fase 1)

| id | label | familia | unit | empate | otros |
|---|---|---|---|---|---|
| `PADEL` | Pádel | sets | games | no | `format {setsToWin:1, gamesPerSet:4, tieBreak:true, openScore:false}`; steppers `setsToWin 1–3`, `gamesPerSet 3–9`; `tournaments: true` |
| `PING_PONG` | Ping pong | sets | puntos | no | `format {setsToWin:2, gamesPerSet:11, tieBreak:false, openScore:false}`; `setsToWin 1–4`, `gamesPerSet 11–11` (fijo, sin stepper) |
| `FIFA` | FIFA | goals | goles | sí | `teams: true`; `tournaments: true` |
| `FUTBOL` | Fútbol | goals | goles | sí | `teams: false` |
| `BASQUET` | Básquet | goals | puntos | no | `teams: false` |

## Global Constraints

- **TDD estricto.** Test que falla primero, visto fallar por el motivo correcto.
- **Gates en cada tarea:** `npm test && npm run test:db && npm run typecheck && npm run build` (Supabase local corriendo).
- **Tests de torneo y de `/rapido` NO se editan.** Si uno falla, el cambio está mal. Los únicos tests existentes que cambian a propósito están listados en su tarea.
- `carga-state.ts`, `wizard.tsx`, `db/read.ts`, `db/discipline.ts`, `db/season.ts`, `core/discipline-slug.ts`, `app/rapido/**`: NO se tocan.
- Tests de permisos por cliente **autenticado**, jamás `adminClient()` (salvo andamiaje).
- Todo select nuevo o cambiado lleva `{ count: 'exact' }` + `assertComplete`.
- Una función por migración (`db/migrations.unit.test.ts`); `0093` no define ninguna.
- Sin dependencias nuevas. Commits convencionales, en castellano como el resto del log, **sin atribución de IA**.
- YAGNI: sin `Record<Family, Strategy>` con interfaz ni fábrica — dos familias son un `switch` sobre `sport.family` con `never` en el `default`.

## Review Focus

1. **Id desconocido en la base** (`'TEJO'`, o un deporte que se sacó del registro): `historyWith` no tira, la fila dice `TEJO`, sus sets se ven si los tiene. Test: Tarea 5 (db + unit de `historial`).
2. **Cambiar de deporte con sets ya cargados**: no puede viajar un `sets`/`gamesPerSet` del deporte anterior. Test: Tarea 6b (cambiar PADEL→PING_PONG vacía sets y pone el formato del nuevo).
3. **Empate forjado en un deporte sin empate** (`BASQUET` con `outcome: 'drew'` o `50-50` por POST a mano) → rechazado por `parseCasualResult`. Test: Tarea 4.
4. **Deuce de ping pong** (`12-10`, `16-14`) se carga en dos toques y al editar prellena `gamesPerSet: 11` (no 12). Test: Tarea 6b.
5. **RPC directa con id con mala forma** (`'padel'`, `''`) → `casual_sport_id`; con id bien formado pero forma incoherente (PADEL con goles) → la base lo ACEPTA a propósito (riesgo 2). Test: Tarea 3.

## Estructura de archivos

| archivo | tarea | qué |
|---|---|---|
| `core/sports.ts` (nuevo) + `core/sports.test.ts` | 1 | registro, tipos, helpers |
| `core/index.ts` | 1 | re-export |
| `core/config.ts` | 2 | `disciplineProfile` lee el registro |
| `app/torneos/nuevo/wizard-state.ts` | 2 | `DISCIPLINE_KINDS`/`LABELS` derivados |
| `supabase/migrations/0093_casual_sport_agnostic.sql` (nuevo) | 3 | constraints |
| `db/friends.db.test.ts` | 3, 5 | test de CHECK reescrito; id desconocido |
| `db/friends.ts` | 4, 5 | parse por familia; lectura agnóstica |
| `db/friends.unit.test.ts` | 4, 5 | parse por familia; mock de sets |
| `app/amigos/historial.tsx` (+ test) | 5 | label y equipo por dato |
| `app/amigos/[playerId]/resultado-sets.tsx`, `resultado-goles.tsx` (nuevos) | 6a | pedazos de formulario por familia |
| `app/amigos/[playerId]/cargar.tsx` (+ test), `cargar-state.ts` (+ test) | 6a, 6b | formulario por familia |

---

### Task 1: El registro de deportes

**Files:** Create `core/sports.ts`, `core/sports.test.ts`; Modify `core/index.ts`
**Est.:** ~170 líneas (registro ~90 con JSDoc, tests ~80)

**Interfaces — Produces** (puro; todavía nadie lo usa):

```typescript
import type { MatchFormat } from './types'

export type ScoringFamily = 'sets' | 'goals'
export interface Range { min: number; max: number }

interface SportBase {
  label: string
  /** Plural, minúscula: 'games' | 'puntos' | 'goles'. El copy lo arma la pantalla. */
  unit: string
  /** Se puede elegir al crear un torneo. Fase 1: sólo PADEL y FIFA (CHECK de `disciplines.kind`). */
  tournaments: boolean
}
export interface SetsSport extends SportBase {
  family: 'sets'
  allowsDraw: false          // la máquina de dos toques no produce empates; `casual_sets_no_draw`
  format: MatchFormat        // defaults, `openScore: false`
  setsToWin: Range
  gamesPerSet: Range         // min === max → fijo, sin stepper
}
export interface GoalsSport extends SportBase {
  family: 'goals'
  allowsDraw: boolean
  teams: boolean
}
export type Sport = SetsSport | GoalsSport

export const SPORTS = {
  PADEL: {
    label: 'Pádel', unit: 'games', family: 'sets', allowsDraw: false, tournaments: true,
    format: { setsToWin: 1, gamesPerSet: 4, tieBreak: true, openScore: false },
    setsToWin: { min: 1, max: 3 }, gamesPerSet: { min: 3, max: 9 },
  },
  PING_PONG: {
    label: 'Ping pong', unit: 'puntos', family: 'sets', allowsDraw: false, tournaments: false,
    format: { setsToWin: 2, gamesPerSet: 11, tieBreak: false, openScore: false },
    setsToWin: { min: 1, max: 4 }, gamesPerSet: { min: 11, max: 11 },
  },
  FIFA:    { label: 'FIFA',    unit: 'goles',  family: 'goals', allowsDraw: true,  teams: true,  tournaments: true },
  FUTBOL:  { label: 'Fútbol',  unit: 'goles',  family: 'goals', allowsDraw: true,  teams: false, tournaments: false },
  BASQUET: { label: 'Básquet', unit: 'puntos', family: 'goals', allowsDraw: false, teams: false, tournaments: false },
} satisfies Record<string, Sport>

export type SportId = keyof typeof SPORTS
/** En el orden del registro: es el orden de los chips. */
export const SPORT_IDS = Object.keys(SPORTS) as SportId[]
export function isSportId(raw: string): raw is SportId          // Object.hasOwn(SPORTS, raw)
export function sportOf(id: SportId): Sport                     // SPORTS[id], tipado como la unión
/** Para LEER: un id fuera del registro se muestra tal cual, nunca tira. */
export function sportLabel(id: string): string
/** La familia de un id del registro, o `null` si no está (el caller decide el fallback). */
export function sportFamily(id: string): ScoringFamily | null

/** Tupla literal a propósito: `Record<DisciplineKind, …>` del wizard necesita las claves exactas. */
export const TOURNAMENT_SPORTS = ['PADEL', 'FIFA'] as const satisfies readonly SportId[]
export type TournamentSport = (typeof TOURNAMENT_SPORTS)[number]
```

`sports.ts` importa SÓLO tipos de `./types` (nada de `./config`: `config.ts` va a importar de acá en la Tarea 2 y el ciclo no hace falta).

- [ ] **Step 1: tests que fallan** (`core/sports.test.ts`):
  1. `SPORTS.PADEL.format` `toEqual(disciplineProfile('PADEL', defaultConfig(4)).config.matchFormat)` — el default de pádel no se mueve.
  2. Rangos de PADEL = los de `STEPPERS` de hoy (`{1,3}`, `{3,9}`) — literal en el test, con comentario a `wizard-state.ts:30` (core no importa app).
  3. `TOURNAMENT_SPORTS` `toEqual(SPORT_IDS.filter((id) => SPORTS[id].tournaments))` **en orden** (la tupla no puede divergir del flag).
  4. Todo id cumple `/^[A-Z][A-Z_]{0,31}$/` (el mismo regex que `casual_sport_id`, Tarea 3).
  5. Toda familia `sets` tiene `format.openScore === false`, `allowsDraw === false`, y `format.setsToWin`/`gamesPerSet` dentro de sus rangos.
  6. `sportLabel('PADEL') === 'Pádel'`, `sportLabel('TEJO') === 'TEJO'`; `sportFamily('BASQUET') === 'goals'`, `sportFamily('TEJO') === null`; `isSportId('Fifa') === false`, `isSportId('toString') === false` (por eso `Object.hasOwn`, no `in`).
- [ ] **Step 2:** `npm test -- core/sports.test.ts` → FAIL (no existe).
- [ ] **Step 3:** implementar; `export * from './sports'` (o la lista explícita, según el estilo de `core/index.ts`).
- [ ] **Step 4: gates + commit** — `feat(core): registro de deportes con familia, unidad y reglas`

---

### Task 2: El torneo deriva sus disciplinas del registro (mismo comportamiento)

**Files:** Modify `core/config.ts:132-145`, `app/torneos/nuevo/wizard-state.ts:107-109`
**Est.:** ~40 líneas. **Ningún test cambia.**

**Interfaces — Consumes:** `SPORTS`, `TOURNAMENT_SPORTS`, `TournamentSport` (Tarea 1). **Produces:** los mismos exports de hoy, con el mismo tipo.

```typescript
// core/config.ts
export function disciplineProfile(kind: TournamentSport, config: SeasonConfig): { config: SeasonConfig; allowsDraw: boolean } {
  const sport = SPORTS[kind]
  const goals = sport.family === 'goals'
  return {
    config: { ...config, matchFormat: { ...config.matchFormat, openScore: goals } },
    allowsDraw: sport.allowsDraw,
  }
}

// app/torneos/nuevo/wizard-state.ts — mismo JSDoc, más una línea que diga de dónde salen
export const DISCIPLINE_KINDS = TOURNAMENT_SPORTS
export type DisciplineKind = TournamentSport
export const DISCIPLINE_LABELS: Record<DisciplineKind, string> = { PADEL: SPORTS.PADEL.label, FIFA: SPORTS.FIFA.label }
```

`DISCIPLINE_LABELS` queda como literal de dos claves a propósito: un `Object.fromEntries` pierde el chequeo de exhaustividad que da `Record<DisciplineKind, …>`.

- [ ] **Step 1: test que falla** — no hay comportamiento nuevo que pedir, así que el "rojo" es estructural: en `core/sports.test.ts` sumar `disciplineProfile` para cada `TournamentSport` devuelve `allowsDraw === SPORTS[kind].allowsDraw` y `openScore === (family === 'goals')`. Pasa ya hoy para PADEL/FIFA; para verlo fallar, cambiar temporalmente `SPORTS.FIFA.allowsDraw` a `false` → PASS contra el `disciplineProfile` NUEVO (lee el registro, así que sigue al cambio) y FAIL contra el viejo (que lo hardcodea): eso prueba que el test mira el registro. Restaurar.
- [ ] **Step 2:** implementar.
- [ ] **Step 3:** `npm test` completo: `core/config.test.ts`, `wizard-state.unit.test.ts`, `cableado-de-formato.unit.test.ts`, `ajustes/page.unit.test.ts` y TODO `test:db` (los que crean disciplinas FIFA/PADEL) en verde **sin editarlos**. `git diff --stat` no muestra ningún `*.test.ts` fuera de `core/sports.test.ts`.
- [ ] **Step 4: gates + commit** — `refactor(torneo): disciplinas y su perfil salen del registro de deportes`

---

### Task 3: La base deja de conocer deportes (`0093`)

**Files:** Create `supabase/migrations/0093_casual_sport_agnostic.sql`; Modify `db/friends.db.test.ts:1189-1212` (reescrito a propósito)
**Est.:** ~90 líneas (migración ~35 con comentarios, test ~55)

```sql
-- docs/plan-registro-de-deportes.md (Tarea 3): el deporte es DATO de la app
-- (`core/sports.ts`), no de la base -- opción B del dueño. 0072 ya está
-- pusheada y no se reescribe; esto la enmienda.
--
-- Se van las tres constraints que nombran un deporte:
--   - el CHECK de la lista (`sport in ('PADEL','FIFA')`), que haría falta
--     tocar por cada deporte nuevo;
--   - `casual_teams_fifa` y `casual_padel_shape`: la forma de un resultado
--     es de la FAMILIA del deporte, que la base no conoce. La valida
--     `parseCasualResult` (db/friends.ts), el único camino de escritura.
-- Queda lo genérico: `casual_score_pair`, `casual_sets_no_draw`, equipos no
-- vacíos, `winner_side in ('A','B')`. Y se suma lo único que se puede decir
-- de un deporte sin nombrarlo: la forma de su id (mismo regex que
-- `core/sports.test.ts`). Las filas de hoy ('PADEL', 'FIFA') la cumplen.
--
-- ponytail: una RPC directa puede guardar un PADEL con goles en SU partido
-- (ya era así con los sets incoherentes, riesgo 9 de plan-amigos-deporte-y-2v2).
-- Si importa: un trigger que valide por familia, con la lista de familias en SQL.
alter table public.casual_matches
  drop constraint casual_matches_sport_check,
  drop constraint casual_teams_fifa,
  drop constraint casual_padel_shape,
  add constraint casual_sport_id check (sport ~ '^[A-Z][A-Z_]{0,31}$');
```

`drop constraint` SIN `if exists`, a propósito: si el nombre autogenerado no es `casual_matches_sport_check`, la migración tiene que fallar fuerte, no dejar el CHECK vivo. Verificarlo en el Step 0.

- [ ] **Step 0:** `npm run db:reset`, después `psql "$(supabase status -o env | rg DB_URL | cut -d= -f2- | tr -d '"')" -c '\d public.casual_matches'` (base LOCAL) → confirmar el nombre `casual_matches_sport_check`. Si difiere, usar el real.
- [ ] **Step 1: test que falla** — reemplazar `it('PADEL con goles, con equipos o con un set 3-3 se rechaza por CHECK…')` por:
  ```typescript
  it('la base no conoce deportes: valida la forma del id y lo genérico, no la lista', async () => {
    // control positivo, un deporte nuevo y uno desconocido pasan la RPC
    for (const p_sport of ['PADEL', 'BASQUET', 'TEJO']) {
      expect((await rpcDirecta(yo.client, yo.playerId, dos.playerId, { p_sport })).error).toBeNull()
    }
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ p_sport: 'padel' }, 'casual_sport_id'],
      [{ p_sport: '' }, 'casual_sport_id'],
      [{ p_sport: 'PADEL', p_sets: [{ set_number: 1, games_a: 3, games_b: 3 }] }, 'casual_sets_no_draw'],
      [{ p_score_a: 1, p_score_b: null }, 'casual_score_pair'],
    ]
    for (const [overrides, constraint] of casos) { /* 23514 + mensaje contiene `constraint` */ }
    expect(await partidosCargadosPor(yo.playerId)).toBe(3)
  })
  ```
  (`rpcDirecta` ya arma por default un FIFA 1v1 válido, `db/friends.db.test.ts:932`.) Y uno explícito del riesgo aceptado: `{ p_sport: 'PADEL', p_sets: setValido, p_score_a: 1, p_score_b: 0 }` → `error` **null** (con un comentario que apunta al `ponytail:` de la `0093`).
- [ ] **Step 2:** `npm run test:db -- db/friends.db.test.ts` → FAIL (`BASQUET` rechazado por el CHECK viejo).
- [ ] **Step 3:** escribir `0093`, `npm run db:reset && npm run db:types` → `git diff db/database.types.ts` vacío (`sport` ya era `string`; si no lo es, commitear el regenerado).
- [ ] **Step 4:** `npm test -- db/migrations.unit.test.ts` verde (cero funciones en `0093`).
- [ ] **Step 5: gates + commit** — `feat(db): el partido casual valida la forma del deporte, no una lista`

---

### Task 4: El resultado casual se valida por FAMILIA

**Files:** Modify `db/friends.ts:770-900` (+ `:924`), `db/friends.unit.test.ts:640-725`
**Est.:** ~230 líneas (código ~90 neto, tests ~140)

**Interfaces — Consumes:** `SPORTS`, `isSportId`, `sportOf`, `SportId`, `SetsSport`, `GoalsSport` (Tarea 1).
**Produces** (cambia el tipo, no la forma):

```typescript
export interface CasualResult {
  sport: SportId            // antes 'PADEL' | 'FIFA'
  playedOn: string
  outcome: 'won' | 'lost' | 'drew'
  scoreMine: number | null; scoreTheirs: number | null   // familia goals
  teamMine: string | null; teamTheirs: string | null     // goals con `teams`
  format: MatchFormat | null                             // familia sets, sólo para validar
  sets: Array<{ mine: number; theirs: number }> | null   // familia sets
}
// CasualResultInput NO cambia (sigue siendo texto crudo; `sport: string`).
// SaveCasualMatchArgs.p_sport: SportId
export function parseCasualResult(input: CasualResultInput): CasualResult
```

Implementación (reusar `intInRange`, `parseSets`, `normalizeTeam`, `esFechaReal`, `matchError` — nada nuevo que valide):

```typescript
const GOALS_FORMAT = disciplineProfile('FIFA', defaultConfig(4)).config.matchFormat // la expresión de hoy, nombrada
const TEAM_SPORTS = SPORT_IDS.filter((id) => { const s = sportOf(id); return s.family === 'goals' && s.teams })
const TEAMS_ONLY = `Los equipos son sólo para ${TEAM_SPORTS.map(sportLabel).join(', ')}.` // hoy: "…sólo para FIFA." — el mismo texto

function parseSetsResult(sport: SetsSport, input: CasualResultInput) {
  // goles o equipos no vacíos → TEAMS_ONLY (igual que hoy)
  const format: MatchFormat = {
    ...sport.format,
    setsToWin: intInRange(input.setsToWin, sport.setsToWin, 'Los sets por partido'),
    gamesPerSet: intInRange(input.gamesPerSet, sport.gamesPerSet, `Los ${sport.unit} por set`),
  }
  // parseSets → matchError(…, format, false) → outcome derivado de los sets (igual que hoy)
}

function parseGoalsResult(sport: GoalsSport, input: CasualResultInput) {
  // outcome ∈ won|lost, o drew sólo si sport.allowsDraw
  //   → 'Decinos quién ganó, o si empataron.' (con empate) / 'Decinos quién ganó.' (sin)
  // marcador opcional (los dos o ninguno) → matchError([...], GOALS_FORMAT, sport.allowsDraw)
  // marcador no empatado: outcome tiene que coincidir (igual que hoy)
  // equipos: si !sport.teams y alguno no vacío → TEAMS_ONLY; si teams → normalizeTeam
}

export function parseCasualResult(input) {
  if (!isSportId(input.sport)) throw new EdgeError('Elegí un deporte de la lista.')
  if (!esFechaReal(input.playedOn)) throw new EdgeError('Elegí una fecha real.')
  const sport = sportOf(input.sport)
  switch (sport.family) {
    case 'sets': …
    case 'goals': …
    default: { const never: never = sport; throw new Error(`familia desconocida: ${String(never)}`) }
  }
}
```

Se borran `SETS_TO_WIN_RANGE`, `GAMES_PER_SET_RANGE` (la copia de `STEPPERS` ya no hace falta: el rango vive en el registro, que `db/` sí puede importar) y `CASUAL_PADEL_DEFAULT` (`rg CASUAL_PADEL_DEFAULT` → sólo `friends.ts`; su valor queda fijado por el test 1 de la Tarea 1).

- [ ] **Step 1: tests que fallan** (`describe('parseCasualResult')`, los de hoy siguen, salvo UNO):
  - **Cambia a propósito:** `'deporte fuera de PADEL/FIFA'` → `'deporte fuera del registro'`: `'Fifa'` y `'TEJO'` → `'Elegí un deporte de la lista.'`.
  - Ping pong: `setsToWin '2', gamesPerSet '11'`, `[11-9, 9-11, 12-10]` → won; `[11-10]` → error de `setError` ("hay que ganar por dos"); `gamesPerSet '12'` → `'Los puntos por set tiene que ser un entero entre 11 y 11.'`.
  - Ping pong con goles → `TEAMS_ONLY` (mismo texto de hoy).
  - Básquet `81-77` + won → ok, `teamMine: null`; `80-80` + won → rechazo de `matchError` ("no admite empates"); sin marcador + `drew` → `'Decinos quién ganó.'`; con equipo → `'Los equipos son sólo para FIFA.'`.
  - Fútbol `2-2` + drew → ok; con equipo → rechazo.
  - FIFA `2-2` + won con equipos → igual que hoy (test existente, sin tocar).
- [ ] **Step 2:** `npm test -- db/friends.unit.test.ts` → FAIL.
- [ ] **Step 3:** implementar; `SaveCasualMatchArgs.p_sport: SportId`.
- [ ] **Step 4: gates + commit** — `feat(amigos): el resultado casual se valida por la familia del deporte`

---

### Task 5: La lectura y el historial no asumen deportes

**Files:** Modify `db/friends.ts:92,112,366,535-592`, `db/friends.unit.test.ts` (mock de sets), `db/friends.db.test.ts` (+1 test), `app/amigos/historial.tsx:3,284-306`, `app/amigos/historial.unit.test.ts`
**Est.:** ~190 líneas

**Interfaces — Consumes:** `sportFamily`, `sportLabel`, `TournamentSport` (Tarea 1).
**Produces:**

```typescript
TournamentMatch.sport: TournamentSport   // mismo tipo que hoy, nombrado; el cast de :366 también
CasualMatch.sport: string                // id tal cual vino; sin CHECK de lista no hay cast honesto
```

`historyWith`, parte casual:
- Borrar `padelIds`. Consulta 10 sobre `ids` (todos los casuales), mismo `count`/`assertComplete`/orden.
- Por fila: `const family = sportFamily(row.sport) ?? (setsPorPartido.has(row.id) ? 'sets' : 'goals')`; `sets: family === 'sets' ? (setsPorPartido.get(row.id) ?? []).map(orientar) : null`. Sacar el cast `row.sport as 'PADEL' | 'FIFA'` y su comentario ("respaldado por el CHECK" ya es falso).

`historial.tsx`:
- `deporte` = `sportLabel(partido.sport)` (sirve para torneo y casual: `TournamentSport` es un `string`). Sale el import de `DISCIPLINE_LABELS` y el comentario de la línea 284.
- `equipo = equipoDe(partido)` sin `partido.sport === 'FIFA'`: `equipoDe` ya devuelve `null` sin equipo, y la familia ya no deja guardar equipos donde no van.

- [ ] **Step 1: tests que fallan:**
  - `friends.unit.test.ts`: un historial sólo-FIFA ahora SÍ consulta `casual_match_sets` (ajustar el fixture/mock que asume lo contrario — cambio a propósito, una línea); una fila `sport: 'TEJO'` con dos filas de sets sale con `sets` orientados; una `'TEJO'` sin sets sale con `sets: null`; una `'PING_PONG'` sale con sus sets.
  - `friends.db.test.ts`: `rpcDirecta({ p_sport: 'TEJO', p_sets: [{ set_number: 1, games_a: 6, games_b: 4 }], p_winner_side: 'A' })` → `historyWith` desde el amigo no tira y devuelve `sport: 'TEJO'`, `sets: [{mine: 4, theirs: 6}]`.
  - `historial.unit.test.ts`: casual `'BASQUET'` muestra "Básquet"; casual `'TEJO'` muestra "TEJO" y su número; la fila de torneo PADEL sigue diciendo "Pádel" (los snapshots de texto de hoy, sin tocar).
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: commit** — `feat(amigos): el historial lee cualquier deporte, también uno que ya no está`

---

### Task 6a: El formulario arma el resultado por familia (PADEL y FIFA idénticos)

Refactor con red: al terminar, la pantalla con PADEL/FIFA se ve y se comporta EXACTAMENTE igual; `cargar.unit.test.ts` no se edita. Los chips siguen siendo `DISCIPLINE_KINDS` en esta tarea.

**Files:** Create `app/amigos/[playerId]/resultado-sets.tsx`, `resultado-goles.tsx`; Modify `cargar.tsx`, `cargar-state.ts` (+ test)
**Est.:** ~330 líneas (se MUEVEN ~230 de `cargar.tsx`; neto nuevo ~100)

**Interfaces — Produces:**

```typescript
// cargar-state.ts
/** El formato a prellenar al editar: lo que se puede deducir de los sets, y lo fijo del deporte. */
export function formatForSport(sport: SetsSport, sets: readonly PadelSet[]): MatchFormat
//   sets vacío → sport.format
//   si no → { ...sport.format, ...formatFromSets(sets) } y, si sport.gamesPerSet.min === max, gamesPerSet = min
//   (formatFromSets NO cambia: el deuce 12-10 daría 12; lo fijo manda)

// resultado-sets.tsx — client component, sin estado propio (todo controlado desde CasualForm)
export function ResultadoSets(props: {
  sport: SetsSport; format: MatchFormat; load: LoadState; otherSide: string
  onFormat: (key: 'setsToWin' | 'gamesPerSet', value: number) => void
  onLoad: (next: LoadState) => void
}): JSX.Element
//   hidden setsToWin/gamesPerSet/sets; un Stepper por eje SÓLO si range.min < range.max;
//   rótulos 'Sets por partido' y `${cap(sport.unit)} por set`; PadelSets movido acá
//   (renombrado SetsTaps), "¿Cuántos ${sport.unit} hizo el que perdió?"

// resultado-goles.tsx
export function ResultadoGoles(props: {
  sport: GoalsSport; uid: string; otherSide: string; rival1Name: string | undefined
  outcome: '' | 'won' | 'lost' | 'drew'; scoreMine: string; scoreTheirs: string; teamMine: string; teamTheirs: string
  onChange: (patch: Partial<{ outcome; scoreMine; scoreTheirs; teamMine; teamTheirs }>) => void
}): JSX.Element
//   radios won/lost + drew sólo si sport.allowsDraw; `${cap(unit)} de tu lado` / `${cap(unit)} de ${rival1Name}`;
//   equipos sólo si sport.teams
```

`cargar.tsx`:
- `const info = sport === '' ? null : sportOf(sport)`; `{info?.family === 'sets' && <ResultadoSets …/>}`, `{info?.family === 'goals' && <ResultadoGoles …/>}`. Se van `isPadel` (`:177`), `!isPadel` (`:365`) y `sport === 'FIFA'` (`:425`).
- `problem` (`:197`): `info?.family === 'sets' && !isComplete(load, format)`.
- Estado inicial de `format` (`:166`): `initial` con sets y deporte `sets` → `formatForSport`; si no, `SPORTS.PADEL.format` (= `defaultConfig(4).matchFormat`, Tarea 1 test 1).
- `useState<'' | SportId>` con `isSportId(initial?.sport ?? '')`; sin `initial` → `'PADEL'` (igual que hoy).
- `cap` = primera letra en mayúscula, inline en cada componente (una línea; no merece un util).

- [ ] **Step 1: tests que fallan** (`cargar-state.unit.test.ts`): `formatForSport(PADEL, [4-2])` → `{…, setsToWin: 1, gamesPerSet: 4}`; `formatForSport(PING_PONG, [12-10, 11-5])` → `gamesPerSet: 11, setsToWin: 2`; `formatForSport(PADEL, [])` → `SPORTS.PADEL.format`. Y en `cargar.unit.test.ts` (nuevo `it`, los viejos intactos): render con `initial.sport: 'BASQUET'` no tiene radio `outcome=drew` y el rótulo dice "Puntos de tu lado"; con `'FIFA'` sí lo tiene y dice "Goles de tu lado".
- [ ] **Step 2–4:** FAIL → implementar → gates. `wc -l cargar.tsx` baja (~680 → ~470).
- [ ] **Step 5: commit** — `refactor(amigos): el formulario casual dibuja el resultado según la familia del deporte`

---

### Task 6b: Los deportes nuevos aparecen en el formulario, con deuce

**Files:** Modify `cargar.tsx`, `cargar.unit.test.ts`, `cargar-state.ts` (+ test), `resultado-sets.tsx`
**Est.:** ~200 líneas

**Interfaces — Produces** (`cargar-state.ts`):

```typescript
/** Botones extra del segundo toque cuando se gana por dos: el perdedor llegó a gamesPerSet-1 o más. */
export function deuceOptions(format: MatchFormat): number[]
//   format.tieBreak || format.openScore → []
//   si no → [gps-1 … gps+3]   (ping pong: 10..14 → 12-10 … 16-14)
//   ponytail: techo en 16-14; un 18-16 no se carga. Si aparece: un input numérico en vez de botones.

/** Cierra el set en curso con el ganador en perdedor+2. Mismas guardas que chooseLoserGames. */
export function chooseDeuce(state: LoadState, loser: number, format: MatchFormat): LoadState
//   pendingWinner null o isComplete → state; si no, agrega {ganador: loser + 2, perdedor: loser}
```

Va en `cargar-state.ts` y NO en `carga-state.ts`: ese archivo lo usan la carga de fechas y `/rapido`, y en el torneo `tieBreak` no es perilla (siempre `true`), así que el deuce no tiene caller allá. YAGNI + no tocar lo que anda.

`cargar.tsx`:
- Chips: `SPORT_IDS.map` + `sportLabel`, en `grid grid-cols-3 gap-2` (5 chips en 390px: 3 + 2; el `flex` de hoy aplasta 5). Se va el import de `DISCIPLINE_KINDS`/`DISCIPLINE_LABELS`.
- Cambiar de deporte: `setSport(id)` + si es `sets` → `setFormat(sportOf(id).format)`; siempre `setLoad(startLoad())`. Nada del deporte anterior viaja.
- `SetsTaps`: después de `loserGamesOptions(format)`, `deuceOptions(format)` con `chooseDeuce`; mismos botones (`TAP`), con `aria-label={`${loser + 2} a ${loser}`}`.
- Editar una fila con id fuera del registro: ningún chip elegido, el submit queda bloqueado por `required` y, si se fuerza, `'Elegí un deporte de la lista.'` (Tarea 4). Sin código extra.

- [ ] **Step 1: tests que fallan:**
  - `cargar-state.unit.test.ts`: `deuceOptions(PADEL.format)` → `[]`; `deuceOptions(PING_PONG.format)` → `[10,11,12,13,14]`; para cada opción y ambos lados, `chooseDeuce` arma un set con `setError(set, format, false) === null` (mismo molde que `carga-state.unit.test.ts:45`); partido cerrado no crece.
  - `cargar.unit.test.ts`: hay 5 radios `sport` en el orden del registro; elegir PADEL, cargar `4-2`, cambiar a PING_PONG → no hay pastillas y el hidden `gamesPerSet` vale `11`; en PING_PONG, "Ganó mi lado" + `10` → pastilla `12-10`; editar un PING_PONG `[12-10, 11-5]` prellena dos pastillas y el hidden `gamesPerSet` `11`.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador** (`npm run dev`, base local): cargar un Básquet 1v1 `81-77` (no hay "Empataron"), un Ping pong 2v2 a 2 sets con un `12-10`, un Fútbol `2-2` empatado; verlos en el historial de cada amigo; editar el ping pong desde la otra cuenta. Cruzar `select sport, winner_side, score_a, score_b from casual_matches` y `casual_match_sets` en `psql` LOCAL. A 390px de ancho: los 5 chips sin scroll horizontal.
- [ ] **Step 6: commit** — `feat(amigos): fútbol, básquet y ping pong en el partido casual`

---

## Riesgos

1. **El torneo se mueve sin querer** — la derivación de la Tarea 2 cambia DE DÓNDE sale el dato, no el dato. Red: ningún test de torneo se edita (`git diff --stat` en el review), y `disciplineProfile` mantiene firma (`TournamentSport` ≡ `'PADEL' | 'FIFA'`).
2. **La base acepta formas incoherentes por RPC directa** (PADEL con goles, BASQUET con sets, empate en BASQUET) — opción B: la app es el único validador. Acotado a los partidos propios de quien escribe a mano (la RLS sigue mandando sobre quién y con quién). Antes ya pasaba con sets incoherentes. Ver `ponytail:` de `0093`.
3. **Ids huérfanos** — sacar un deporte del registro deja filas con ese id: se leen (label = id, familia inferida) pero no se editan sin elegir otro deporte. Cambiar la familia al editar (ping pong → fútbol) no deja sets colgados: `save_casual_match` (`0092:70`) borra los sets en cada edición y reinserta lo que llega (`[]` en goals). Verificarlo en la Tarea 6b, Step 5 (editar un ping pong a fútbol → 0 filas en `casual_match_sets`).
4. **Nombre autogenerado del CHECK** — si no es `casual_matches_sport_check`, la `0093` falla (bien). Step 0 de la Tarea 3.
5. **Deuce con techo** — 16-14 en ping pong es el máximo cargable (`ponytail:` en `deuceOptions`).
6. **`historyWith` hace una consulta más** cuando el historial casual es sólo de goles. Medido en bytes: un `.in()` de los mismos ids que ya viajan en la consulta 7; aceptado.
7. **El mensaje de deporte inválido cambia** (`'Elegí Pádel o FIFA.'` → `'Elegí un deporte de la lista.'`): sólo lo ve quien arma un POST a mano; un único test lo fija y cambia a propósito (Tarea 4).

## Lo que este plan NO hace (Fase 2)

- **Torneo sobre el registro:** sacar el CHECK de `disciplines.kind`, ensanchar `DisciplineKind` a más deportes, los `Record<DisciplineKind, …>` literales de `wizard.tsx:796-882`, `db/read.ts`/`db/discipline.ts`/`db/season.ts`/`core/discipline-slug.ts` con su `'PADEL' | 'FIFA'`.
- **`/rapido` sobre el registro.**
- **Tenis** (tercera regla de set + `MatchFormat` + dos toques con ganador ≠ `gamesPerSet`) y **vóley** (set decisivo a 15, carga tipeada).
- `gamesPerSet` variable para ping pong (a 21), deuce sin techo, tie-break como perilla, un deporte `sets` con empate.
- Validar la forma por familia en la base (trigger) — ver riesgo 2.
