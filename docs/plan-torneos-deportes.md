# Torneos con los deportes del registro — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⚠ Leer antes de ejecutar
>
> - **Spec (vinculante):** `docs/torneos-deportes.md` + mockups `docs/mockups/torneos-deportes-wizard.png`
>   y `docs/mockups/torneos-deportes-personalizar-reglas.png`. Cada subagente los lee antes de su tarea.
> - **Rama:** `feature/torneos-deportes` (desde `integracion/multi-disciplina-con-rapidos` @ `8e65bc6`).
>   Última migración: `0093_casual_sport_agnostic.sql`. Antes de la Tarea 2:
>   `eza supabase/migrations | tail -1` tiene que dar `0093…`; si hay otra, renumerar `0094`–`0098`.
> - **Hay un `next dev` ajeno en `:3000` corriendo DESDE ESTE checkout** (`/proc/<pid>/cwd` =
>   el repo). No se toca, no se mata, y **nada escribe `.next` en este checkout**: `npm run build`
>   y el dev server de las verificaciones corren en un **worktree temporal** (receta en Global
>   Constraints).
> - **Base: sólo la LOCAL** (`127.0.0.1:54321/54322`). La comparte el `:3000` del dueño:
>   migraciones nuevas con `npx supabase migration up` (no `db reset`, que borra sus datos). Si la
>   CLI no tiene `migration up`, preguntar antes de resetear.
> - El dueño pidió: **la UI es lo más importante**, y **sin romper nada**: ningún torneo existente
>   cambia de comportamiento, los tests de torneo y de `/rapido` no se editan salvo lo listado acá.

**Goal:** Crear y configurar un torneo de Pádel, Ping pong o FIFA (1 o 2 por lado) desde la ficha
de cada deporte: un wizard de 4 pasos, una hoja "Personalizar reglas" compartida con Ajustes, un
reglamento en criollo que dice lo mismo en los tres lugares, `AUTO` y formato de partido propio
por fecha, y las palabras/unidades del deporte en todas las pantallas.

**Architecture:** La ficha es **dato** en `core/sports.ts` y sólo siembra valores (enfoque A, spec
§9): `fichaSeed(kind, plantel, modalidad)` arma la fila completa de `disciplines` y de ahí en más el
torneo es dueño de su config, guardada en las mismas columnas de hoy. Una función pura
(`reglamento`, `core/reglamento.ts`) narra cualquier disciplina; una regla pura
(`effectiveMatchFormat`) da "a cuánto se juega esta fecha" y la consumen la carga, el servidor, la
tabla y los textos. La base suma un CHECK de forma de id, `AUTO` sólo en DRAFT y
`matchdays.match_format` inmutable fuera de DRAFT. El wizard nuevo vive en archivos nuevos y
reemplaza al viejo de una vez (Tarea 12); el viejo se borra cuando nadie lo importa (Tarea 16).

**Tech Stack:** Next.js 15, React 19, TS 5.7 strict, Supabase (RLS, migraciones SQL), Tailwind v4
(tokens en `app/globals.css`), vitest (`renderToStaticMarkup` en unit, sin DOM), Playwright vía
`scripts/playwright.mjs` (no es dependencia del repo).

**Spec:** `docs/torneos-deportes.md`

## Decisiones tomadas (no se re-discuten)

| tema | decisión | por qué / evidencia |
|---|---|---|
| dónde vive la ficha | campo `ficha: TournamentFicha \| null` en cada entrada de `SPORTS` (`core/sports.ts`); `null` en Fútbol/Básquet | spec §3 "sólo datos en core/sports.ts"; `core/` no importa `db/` ni `app/` |
| curva de puntos (`pointsBySides`) | **no es un campo**: la curva de hoy depende sólo de la cantidad de lados (`DEFAULT_POINTS`/`onlyTopSix`, `core/config.ts:62-119`) y es la misma para los tres deportes; `fichaSeed` usa `defaultConfig(plantel, lados).points` | spec §3: "la curva individual que hoy usa FIFA" = la misma función. Un campo con la misma función tres veces es YAGNI |
| palabras (`words`) | `sideWords(pairSize)` → `jugador/jugadores/el mejor jugador` · `pareja/parejas/la mejor pareja` (igual para los tres deportes); lo único propio del deporte es la etiqueta de cada modalidad (`modalities[].label`: ping pong dice "Dobles fijos"/"Dobles que rotan", mockup) | la tabla de §3 da "pareja" a Pádel porque Pádel no tiene individual; la palabra sigue a la modalidad, no al deporte |
| orden de las modalidades | la ficha las lista en orden de §3 (la primera es la marcada); la tarjeta las **dibuja** en `MODALITY_ORDER = INDIVIDUAL · FIJAS · ROTAN` | así salen los dos mockups (Pádel: "Parejas fijas · **Parejas que rotan**") |
| Masters de FIFA en parejas | `false` (tabla §3: FIFA "no"). Hoy un FIFA 2v2 de una sola disciplina nacía con Masters por el automático de `pair_size=2` (`db/season.ts:453`) | tabla explícita del spec; se puede prender en la hoja |
| "Primera fecha" guardada | `SeasonConfig.firstFecha?: 'NIVEL' \| 'SORTEO'` (opcional como `maxMatches`). "Igual que X" guarda el modo de X. Ausente = torneo de antes: Reglas no narra esa frase | Reglas (§6) dice "la primera fecha se armó por nivel": hay que guardarlo; ningún cálculo lo lee |
| tiempo verbal del reglamento | presente ("se arma") en los tres lugares | una sola función (§6) se usa antes y después de crear |
| sorteo "Al azar" | `createSeason` recibe `shuffle: true` y sortea en el servidor (Fisher-Yates, `Math.random`); lo guarda en `discipline_entries.seed_position` | spec §4 "el servidor sortea y guarda el resultado como orden" |
| orden de parejas | con parejas fijas el orden se guarda por persona con los dos de cada pareja **contiguos**; sorteo de parejas = sortear unidades (pareja o suelto) | spec §4 "el orden es de parejas"; el motor no cambia |
| subpasos | "Armá las parejas" va **antes** de "Ordená por nivel" | ordenar parejas fijas por nivel necesita las parejas armadas |
| parejas al crear | "Continuar" en "Armá las parejas" pide **a todos emparejados** ("Sortear parejas" completa) | la tabla de ese deporte va a ser por pareja (§8) |
| cambios de plantel | volver a "Jugadores" y cambiar el plantel **resetea** parejas y orden de todos los deportes | sin índices viejos en el payload; el wizard viejo necesitaba 10 funciones para seguir índices (`wizard-state.ts:494-691`) |
| "Grupos + llave" en la hoja | tres botones (mockup) y, si se elige grupos, un segundo renglón `2 grupos · 4 grupos` | "todo lo que hoy se puede configurar se sigue pudiendo" (hoy: 2 y 4, `wizard-state.ts:1107`) |
| "Partidos por fecha" (`maxMatches`) | sigue editable, en el bloque "La fecha" de la hoja | idem (hoy en `ajustes/formato.tsx:157-174`) |
| `AUTO` en la fecha | `generatePairs` lo resuelve **en memoria** con `resolveFormato` (= `suggestFormat`); `openMatchday` ("Confirmar fecha") **escribe** el formato concreto antes de `open_matchday`; la base rechaza `AUTO` fuera de DRAFT | spec §7 "al confirmar el armado se guarda el concreto"; resolver recién al confirmar deja que "Automático" siga a la asistencia mientras se arma |
| formato de partido de la fecha | `matchdays.match_format` guarda **sólo** `{setsToWin, gamesPerSet}`; `effectiveMatchFormat(disciplina, propio)` completa `tieBreak`/`openScore` de la disciplina | un PATCH no puede cambiar la familia del marcador |
| congelar al confirmar | `openMatchday` también escribe `match_format = efectivo` si estaba `null` | hace verdadero el aviso de Ajustes "Los cambios valen desde la próxima fecha. Las fechas ya jugadas quedan como se jugaron" (§5): sin esto, cambiar games en Ajustes con una fecha OPEN invalidaba sus resultados al cerrar |
| aviso "Fecha 3 · …" | se muestra sólo si el formato efectivo de la fecha **difiere** del de la disciplina hoy; texto `Fecha 3 · 1 set a 6 games` (`formatLabel`) | §6 "Alguna fecha puede jugarse a otra cosa: se avisa en esa fecha" |
| Ajustes guarda la hoja | una action llama a los tres escritores que ya existen (`updateDisciplineConfig`/`HasMasters`/`FormatoDefault`, `db/discipline.ts:133,192,232`) sólo para lo que cambió | ninguna función de base nueva, ningún test de base tocado. `ponytail:` no es atómico |
| "Agregar un deporte" → "Por nivel" | usa el orden actual del torneo (`season_seed_order`, como hoy `addDiscipline`); no hay lista para ordenar en Ajustes | YAGNI; hoy tampoco se puede reordenar después de crear |
| Reglas | ambas ramas (con y sin sesión) leen `season_public_formats` (que pasa a dar `fixed_teams` y `formato_default`); arriba el reglamento en criollo; **el acordeón de hoy (`narrateRules`) se queda debajo, cerrado, bajo "Más detalle"**, ajustado para no contradecir al reglamento (unidad del deporte, sin "Cómo se arman las parejas" con parejas fijas, sin afirmar "todos contra todos") | §6 + **decisión del dueño** (2026-10-14): el detalle (cómo se arman las parejas, desempates dentro de la fecha, invitados) no se borra |
| Automático | `AUTO` = `suggestFormat` tal cual: con 6 jugadores de a uno arma 2 grupos + llave (10 partidos); para todos contra todos se elige al armar esa fecha. El texto del mockup de ping pong ("todos contra todos (15 partidos)") queda superado | **decisión del dueño** (2026-10-14); agregado a `docs/torneos-deportes.md` §7 |
| individual en el armado | sin sección "Jugadores invitados"/"+ Agregar 2 invitados"; el invitado suelto ("+ Agregar invitado", que ya anda con `pair_size=1`: `syncGuestSeat` sale temprano, `db/matchday.ts:621-625`) se dibuja sin "Juega con" | §8; dos invitados de a uno = dos sueltos |
| wizard viejo | `wizard.tsx` y su test se borran (Tarea 16). De `wizard-state.ts` se queda lo que importan tests de base (`buildDisciplines`, `newTournamentPayload`, `configFor`, `Squad`: `db/public-formats.db.test.ts:4`, `db/open-score-screens.db.test.ts:12`, `db/season-multi-discipline.db.test.ts:2`, `ajustes/formato.unit.test.ts:5`) con `DISCIPLINE_KINDS` **congelado** en `['PADEL','FIFA']` | esos tests ejercitan `createSeason` y no se editan |

## La ficha (valores exactos)

| campo | `PADEL` | `PING_PONG` | `FIFA` |
|---|---|---|---|
| `modalities` (orden de la ficha) | `ROTAN` "Parejas que rotan", `FIJAS` "Parejas fijas" | `INDIVIDUAL` "Individual", `FIJAS` "Dobles fijos", `ROTAN` "Dobles que rotan" | `INDIVIDUAL` "Individual", `FIJAS` "Parejas fijas", `ROTAN` "Parejas que rotan" |
| formato de partido | `SPORTS.PADEL.format` (1 set a 4, tie-break), sets 1–3, games 3–9 (ya existe) | `SPORTS.PING_PONG.format` (2 sets a 11, sin tie-break), sets 1–4, puntos 11 fijo (ya existe) | marcador abierto (`openScore: true`), como `disciplineProfile('FIFA')` hoy |
| `season` | `{ regularMatchdays: 10, countBestOf: 8, tiebreakSnapshotEvery: 3 }` | ídem | ídem |
| `masters` | `true` | `false` | `false` |
| `fechaFormat` | `{ kind: 'AUTO' }` | ídem | ídem |
| `firstFecha` | `{ INDIVIDUAL: 'SORTEO', FIJAS: 'SORTEO', ROTAN: 'NIVEL' }` | ídem | ídem |
| `tournaments` | `true` | **`true` en la Tarea 19** | `true` |

`fichaSeed` para Pádel y FIFA da **exactamente** la config que da hoy el wizard
(`disciplineProfile(kind, defaultConfig(n, lados)).config`) más `firstFecha` — test de la Tarea 1.

## Global Constraints

- **TDD estricto.** Test que falla primero, visto fallar por el motivo correcto, después el código.
- **Gates en cada tarea:** `npm test && npm run test:db && npm run typecheck` en el checkout, y
  `next build` en un worktree temporal (nunca en el checkout: `.next` es del `:3000` ajeno):
  ```bash
  WT="$SCRATCH/wt-$(date +%s)"            # $SCRATCH = el scratchpad de tu sesión
  git add -A
  git worktree add --detach "$WT" HEAD
  git diff --cached --binary | git -C "$WT" apply --index
  ln -s "$PWD/node_modules" "$WT/node_modules" && cp .env.local "$WT/.env.local"
  (cd "$WT" && npx next build)
  git worktree remove --force "$WT"
  ```
- **Navegador (tareas con UI):** mismo worktree (sin `git worktree remove` hasta terminar),
  `(cd "$WT" && npx next dev -p 3107)` en background (antes: `ss -ltn | rg ':3107'` vacío; si no,
  otro puerto libre; **jamás :3000**). Script Playwright en el scratchpad (no se commitea) con
  `launchChromium` de `scripts/playwright.mjs` (`PLAYWRIGHT_DIR=/tmp/smoke`), login
  `admin@demo.com` / `demodemo`, viewport **390×844**, una pasada `colorScheme: 'light'` y otra
  `'dark'`, `document.documentElement.scrollWidth === 390` (sin scroll horizontal). Capturas en el
  scratchpad, nombradas `tNN-<pantalla>-<tema>.png`, y su lista en el informe de la tarea. Cruzar
  con `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres` lo que la pantalla afirma.
  Matar el dev server al terminar.
- **Sin atribución de IA** en commits (ni `Co-Authored-By`, ni "Generated with"). Convencionales,
  en castellano como el resto del log.
- **Tests de torneo y de `/rapido` NO se editan**, salvo lo listado en "Tests existentes que
  cambian a propósito" de cada tarea (copy que cambia a propósito, firma de una función con el
  mismo texto esperado, un campo nuevo en un fixture de tipo, o el test de código que se borra a
  propósito). Si otro test cae, el cambio está mal. El revisor de cada tarea corre
  `git diff --stat HEAD~1 -- '*.test.ts'` y lo compara contra la lista.
- **`carga-state.ts` no cambia de contrato** (dos toques; lo comparten la carga de fechas y
  `/rapido`). El formato efectivo se le pasa como hoy se le pasa el de la disciplina. `app/rapido/**`
  no se toca (sí se IMPORTA `tocarJugador`/`agruparChips` de `app/rapido/armar-state.ts`).
- **La config guardada de un torneo existente nunca se recalcula desde la ficha.** La ficha sólo la
  lee `fichaSeed` (crear y "Agregar un deporte") y "Volver a las reglas de <deporte>" (un toque
  explícito). Las pantallas leen de la ficha sólo palabras y unidades.
- **Una función por migración** (`db/migrations.unit.test.ts`). Ninguna migración existente se
  reescribe.
- **Permisos con clientes autenticados** (`createTestUser().client`); `adminClient()` sólo como
  andamiaje (p. ej. mover `status` para probar un CHECK).
- **Todo select de lista NUEVO** lleva `{ count: 'exact' }` + `assertComplete` (hoy privada en
  `db/friends.ts:52`; la primera tarea que la necesite la mueve a `db/errors.ts` y la exporta, sin
  cambiar el mensaje).
- **Base local solamente.** Nada contra una base remota.
- **UI: estilo de la casa.** Opciones excluyentes = botones de `/rapido`
  (`app/rapido/armar.tsx:51-87`: `min-h-[44px] flex-1 rounded-field p-3 text-center text-[14px]
  font-extrabold`, elegida `bg-accent text-accent-text`, resto `bg-chip text-text`,
  `aria-pressed`, `role="group"` + `aria-labelledby`). Tarjetas = las de amigos
  (`rounded-card border border-line bg-surface p-4`, `app/amigos/page.tsx:151`). Rótulos =
  `text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted`. Steppers = `Stepper`
  (44px). Colores sólo con tokens de `app/globals.css` (claro y oscuro). Toque mínimo 44px. Sin
  dependencias nuevas.
- **YAGNI.** Sin interfaces de una implementación, sin config para valores que no cambian.
  `ponytail:` en cada atajo con techo conocido.

## Review Focus

1. **Payload forjado** (la Server Action recibe JSON sin esquema): `kind: 'TEJO'`/`'FUTBOL'`,
   `teams` que se pisan o con índices fuera de rango, `teams` en individual, `sameOrderAs`
   apuntando a sí mismo o a otro "igual que" → `EdgeError` en castellano y **ninguna temporada
   creada**. Tests: Tareas 3 y 11.
2. **Índices viejos tras editar el plantel**: armar parejas y orden, volver a "Jugadores", sacar a
   alguien, volver → parejas y orden vacíos, nunca un índice de un asiento que ya no está.
   Test: Tarea 10 (`plantelCambio`).
3. **Torneo existente** (PADEL, `ROUND_ROBIN`, sin `firstFecha`, `has_masters`): Reglas lo narra
   sin la frase de primera fecha y con "todos contra todos"; la hoja en Ajustes abre con SU
   config, no la de la ficha; guardar sin tocar nada no escribe. Tests: Tareas 6, 7, 14.
4. **Cambiar a cuánto se juega con resultados cargados** (fecha vuelta a armado con
   `redraft_matchday`, que no borra `match_sets`): `setMatchFormat` rechaza con un mensaje que
   dice qué hacer, en vez de dejar una fecha que no cierra. Test: Tarea 4.
5. **Plantel impar + modalidad de parejas elegida en el paso 3** (el piso del paso 2 se calculó con
   la modalidad por defecto): el paso 3 avisa y no deja seguir. Test: Tarea 10
   (`errorDeModalidades`).

## Estructura de archivos

| archivo | tarea | qué |
|---|---|---|
| `core/types.ts` | 1, 4 | `FirstFecha`, `MatchdayFormatSetting`, `SeasonConfig.firstFecha?`, `MatchFormatOwn` |
| `core/sports.ts` (+ test) | 1, 3, 19 | ficha, modalidades, `sideWords`, `unitOf`, `isTournamentSport`, `sportFormatError`; ping pong |
| `core/config.ts` (+ test) | 1, 4 | `fichaSeed`, `validateConfig` con `firstFecha`, `effectiveMatchFormat` |
| `core/knockout.ts` (+ test) | 4 | `resolveFormato` |
| `core/order.ts` (+ test) | 11 | `shuffled` |
| `core/narrate.ts` (+ test) | 5, 7 | unidades por parámetro; `narrateRules` con unidad y parejas fijas |
| `core/reglamento.ts` (nuevo, + test) | 6 | `reglamento`, `fichaLine`, `desempateLine` |
| `core/discipline-slug.ts` (+ test) | 3 | `ping-pong` |
| `supabase/migrations/0094…0097` | 2 | kind, `AUTO`, `match_format`, trigger |
| `supabase/migrations/0098_season_public_formats_modalidad.sql` | 7 | Reglas pública con modalidad y formato |
| `db/torneos-deportes.db.test.ts` (nuevo) | 2, 3, 4, 11, 14, 15, 19 | todo lo de base de este plan |
| `db/read.ts`, `db/season.ts`, `db/discipline.ts`, `db/matchday.ts` | 3, 4, 7, 11, 15 | tipos, guardas, AUTO, formato efectivo, sorteo |
| `app/stepper.tsx` (nuevo) | 8 | `Stepper` mudado de `wizard.tsx` |
| `app/deporte/personalizar-reglas{,-state}.ts(x)` (nuevos) | 8 | la hoja |
| `app/deporte/tarjeta{,-state}.ts(x)` (nuevos) | 9 | la tarjeta del paso 3 (también Ajustes) |
| `app/torneos/nuevo/crear-state.ts`, `crear.tsx`, `subpasos.tsx` (nuevos) | 10, 12, 13 | el wizard nuevo |
| `app/torneos/nuevo/wizard.tsx` (+ test) | 16 | se borran |
| `app/torneo/[id]/reglas/*` | 7 | página Reglas |
| `app/torneo/[id]/ajustes/*`, `[disciplina]/ajustes/page.tsx` | 14, 15 | hoja en Ajustes, "Agregar un deporte" |
| `app/torneo/[id]/[disciplina]/fechas/[n]/*` | 4, 5, 17, 19 | AUTO, "Esta fecha se juega a", palabras, ventaja |
| `app/torneo/[id]/tabla-view.tsx`, `tabla-state.ts`, `[disciplina]/page.tsx` | 5, 18 | corte de Masters, tabla por pareja |

---

### Task 1: La ficha de cada deporte

**Files:** Modify `core/types.ts:37-63` (SeasonConfig), `core/sports.ts`, `core/config.ts`, `core/index.ts:77,239-240`; Test `core/sports.test.ts`, `core/config.test.ts`
**Est.:** ~260 líneas (código ~110, tests ~150). **Ningún test existente cambia.**

**Interfaces — Produces:**

```typescript
// core/types.ts
export type FirstFecha = 'NIVEL' | 'SORTEO'
/** Lo que guarda `disciplines.formato_default` y, mientras la fecha está en DRAFT, `matchdays.formato`. */
export type MatchdayFormatSetting = MatchdayFormat | { readonly kind: 'AUTO' }
// SeasonConfig gana, junto a `maxMatches?`:
  /** Cómo se armó la primera fecha. Ausente = torneo anterior a este plan. Sólo lo narra Reglas. */
  firstFecha?: FirstFecha

// core/sports.ts
export type Modality = 'INDIVIDUAL' | 'FIJAS' | 'ROTAN'
/** Orden en que se DIBUJAN los botones (mockups). El orden de la ficha decide sólo cuál viene marcada. */
export const MODALITY_ORDER: readonly Modality[] = ['INDIVIDUAL', 'FIJAS', 'ROTAN']
export interface TournamentFicha {
  /** En el orden de la ficha: la primera es la marcada. */
  modalities: readonly { id: Modality; label: string }[]
  season: { regularMatchdays: number; countBestOf: number; tiebreakSnapshotEvery: number }
  /** Masters por defecto con parejas. De a uno nunca (`disciplines_has_masters_needs_pair`, 0053). */
  masters: boolean
  fechaFormat: MatchdayFormatSetting
  firstFecha: Record<Modality, FirstFecha>
}
// SportBase gana `ficha: TournamentFicha | null` (null en FUTBOL y BASQUET)
export function modalityOf(pairSize: SideSize, fixedTeams: boolean): Modality
export function modalityShape(modality: Modality): { pairSize: SideSize; fixedTeams: boolean }
/** La de la ficha; para un id fuera del registro, la genérica ("Individual"/"Parejas fijas"/"Parejas que rotan"). */
export function modalityLabel(kind: string, modality: Modality): string
export function sideWords(pairSize: SideSize): { one: string; many: string; best: string }
/** `SPORTS[kind].unit`; fuera del registro: 'goles' con `openScore`, 'games' si no. Nunca tira. */
export function unitOf(kind: string, format: MatchFormat): string
export function isTournamentSport(raw: string): raw is TournamentSport   // isSportId && en TOURNAMENT_SPORTS

// core/config.ts
export interface DisciplineSeed {
  config: SeasonConfig           // con `firstFecha`
  pairSize: SideSize
  fixedTeams: boolean
  allowsDraw: boolean
  hasMasters: boolean
  formatoDefault: MatchdayFormatSetting
}
/** Siembra una disciplina desde la ficha. Tira (Error, no EdgeError) si el deporte no tiene ficha o no ofrece esa modalidad: es un bug del llamador. */
export function fichaSeed(kind: SportId, squadSize: number, modality: Modality): DisciplineSeed
```

Implementación de `fichaSeed` (la única con lógica):

```typescript
export function fichaSeed(kind: SportId, squadSize: number, modality: Modality): DisciplineSeed {
  const sport = sportOf(kind)
  const ficha = sport.ficha
  if (ficha === null || !ficha.modalities.some((option) => option.id === modality)) {
    throw new Error(`${kind} no se juega en ${modality}.`)
  }
  const { pairSize, fixedTeams } = modalityShape(modality)
  const base = defaultConfig(squadSize, pairSize)
  const matchFormat = sport.family === 'sets' ? sport.format : { ...base.matchFormat, openScore: true }
  return {
    config: { ...base, ...ficha.season, matchFormat, firstFecha: ficha.firstFecha[modality] },
    pairSize,
    fixedTeams,
    allowsDraw: sport.allowsDraw,
    hasMasters: ficha.masters && pairSize === 2,
    formatoDefault: ficha.fechaFormat,
  }
}
```

`validateConfig` suma: `if (config.firstFecha !== undefined && config.firstFecha !== 'NIVEL' && config.firstFecha !== 'SORTEO') errors.push('La primera fecha tiene que ser por nivel o al azar.')` (la config viaja como JSON de cliente).

- [ ] **Step 1: tests que fallan** (`core/sports.test.ts`, `describe('la ficha')`; `core/config.test.ts`, `describe('fichaSeed')`):
  1. Todo `id` con `tournaments: true` tiene `ficha !== null`; `PING_PONG.ficha !== null`; `FUTBOL`/`BASQUET` `null`.
  2. Cada ficha: `modalities` no vacía, ids sin repetir, labels no vacíos; `modalities[0].id` = `ROTAN` (Pádel), `INDIVIDUAL` (Ping pong, FIFA).
  3. **La ficha nombra lo de hoy**: `const { firstFecha, ...rest } = fichaSeed('PADEL', 8, 'ROTAN').config` → `rest` `toEqual(disciplineProfile('PADEL', defaultConfig(8, 2)).config)` y `firstFecha === 'NIVEL'`; ídem `('FIFA', 8, 'INDIVIDUAL')` contra `defaultConfig(8, 1)` (`firstFecha 'SORTEO'`) y `('FIFA', 8, 'ROTAN')` contra `defaultConfig(8, 2)`.
  4. `fichaSeed('PING_PONG', 6, 'INDIVIDUAL').config.matchFormat` `toEqual(SPORTS.PING_PONG.format)`; `points` `toEqual([10, 7, 5, 3, 2, 1])`.
  5. Para cada deporte con ficha × modalidad que ofrece × plantel de `minSquadFor(lados)` a 24 (sólo pares con parejas): `validateConfig(seed.config, seed.pairSize)` `toEqual([])`; `INDIVIDUAL` ⇒ `pairSize 1, fixedTeams false, hasMasters false`; `FIJAS` ⇒ `2, true`; `ROTAN` ⇒ `2, false`; `formatoDefault` `toEqual({ kind: 'AUTO' })`.
  6. `fichaSeed('PADEL', 8, 'ROTAN').hasMasters === true`; `fichaSeed('FIFA', 8, 'ROTAN').hasMasters === false`; `fichaSeed('FUTBOL', 8, 'INDIVIDUAL')` y `fichaSeed('PADEL', 8, 'INDIVIDUAL')` tiran.
  7. `modalityShape(modalityOf(p, f))` ida y vuelta para `(1,false) (2,true) (2,false)`; `modalityLabel('PING_PONG', 'FIJAS') === 'Dobles fijos'`; `modalityLabel('TEJO', 'ROTAN') === 'Parejas que rotan'`.
  8. `sideWords(1)` `toEqual({ one: 'jugador', many: 'jugadores', best: 'el mejor jugador' })`; `sideWords(2)` → `pareja/parejas/la mejor pareja`.
  9. `unitOf('PING_PONG', SPORTS.PADEL.format) === 'puntos'`; `unitOf('TEJO', { ...f, openScore: true }) === 'goles'`; `unitOf('TEJO', { ...f, openScore: false }) === 'games'`.
  10. `isTournamentSport('PADEL') === true`; `('FUTBOL')`, `('toString')`, `('padel')` `false`. (No fijar `PING_PONG` acá: cambia en la Tarea 19.)
  11. `validateConfig({ ...defaultConfig(8), firstFecha: 'X' as never }, 2)` contiene `'La primera fecha tiene que ser por nivel o al azar.'`; sin `firstFecha`, sin ese error.
- [ ] **Step 2:** `npm test -- core/sports.test.ts core/config.test.ts` → FAIL (no existen).
- [ ] **Step 3:** implementar. Exportar todo lo nuevo desde `core/index.ts` (lista explícita, `:77` y `:239-240`). Actualizar el JSDoc de `tournaments` (`core/sports.ts:21`).
- [ ] **Step 4: gates + commit** — `feat(core): la ficha de cada deporte siembra la disciplina de un torneo`

---

### Task 2: La base acepta cualquier deporte, `AUTO` y el formato de partido de la fecha

**Files:** Create `supabase/migrations/0094_disciplines_kind_id_shape.sql`, `0095_formato_auto.sql`, `0096_matchdays_match_format.sql`, `0097_matchdays_match_format_immutable_after_draft.sql`, `db/torneos-deportes.db.test.ts`; Modify `db/database.types.ts` (regenerado)
**Est.:** ~300 líneas (SQL ~110 con comentarios, test ~190). **Ningún test existente cambia.**

**Interfaces — Produces:** columna `matchdays.match_format jsonb null` (`{setsToWin, gamesPerSet}`), grant `update (match_format)` a `authenticated`; constraints `disciplines_kind_id`, `disciplines_formato_default_kind` (con `AUTO`), `matchdays_formato_kind` (con `AUTO`), `matchdays_formato_auto_draft`, `matchdays_match_format_shape`; trigger `matchdays_match_format_immutable_after_draft`. Ningún tipo de TS de dominio cambia en esta tarea (los jsonb son `Json`).

- [ ] **Step 0:** `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c '\d public.disciplines'` y `-c '\d public.matchdays'` → confirmar `disciplines_kind_check` (`0015_disciplines.sql:15`), `disciplines_formato_default_kind` (0074), `matchdays_formato_kind` (0040). Si un nombre difiere, usar el real. `drop constraint` **sin** `if exists`: si el nombre está mal tiene que fallar fuerte.
- [ ] **Step 1: test que falla** (`db/torneos-deportes.db.test.ts`; temporada con `createSeason` de `db/test/factories.ts`, escrituras con `admin.client` autenticado):
  1. `kind`: `admin.client.from('disciplines').insert({ season_id, kind: 'PING_PONG', config: defaultConfig(8), position: 1 })` → `error` null (grant de `0020:44` incluye `kind`). `'ping-pong'`, `''`, `'Padel'` → `code 23514` y mensaje con `disciplines_kind_id`.
  2. `formato_default`: update `{ kind: 'AUTO' }` → `count 1`; `{ kind: 'MAGIC' }` → 23514 `disciplines_formato_default_kind`.
  3. `matchdays.formato`: fecha DRAFT (`createMatchday(admin.client, seasonId, disciplineId)`), update `formato: { kind: 'AUTO' }` con `admin.client` → ok. Andamiaje: `adminClient().from('matchdays').update({ status: 'OPEN' })` → 23514 `matchdays_formato_auto_draft`. Con `formato` ROUND_ROBIN el mismo update pasa (control positivo).
  4. `match_format` en DRAFT con `admin.client`: `{ setsToWin: 2, gamesPerSet: 6 }` → ok; `null` → ok; rechazos 23514 `matchdays_match_format_shape`: `{ setsToWin: 0, gamesPerSet: 6 }`, `{ setsToWin: 2 }`, `{ setsToWin: 2, gamesPerSet: 6, tieBreak: false }`, `'"x"'`, `[1, 2]`, `{ setsToWin: 2, gamesPerSet: 100 }`.
  5. Trigger: pasar la fecha a OPEN (andamiaje `adminClient`), `admin.client` update `match_format` → `error.message` contiene `'A cuánto se juega la fecha sólo se cambia con la fecha en armado.'`; ídem CLOSED. Mismo valor que ya tiene → sin error (`is distinct from`).
  6. Un participante que no organiza (otro `createTestUser` con asiento): update `match_format` en DRAFT → `count 0` (RLS `matchdays_write`).
- [ ] **Step 2:** `npm run test:db -- db/torneos-deportes.db.test.ts` → FAIL.
- [ ] **Step 3: migraciones** (cada una con su comentario de cabecera: plan, spec §9, por qué):

```sql
-- 0094_disciplines_kind_id_shape.sql — sin funciones
alter table public.disciplines
  drop constraint disciplines_kind_check,
  add constraint disciplines_kind_id check (kind ~ '^[A-Z][A-Z_]{0,31}$');
```

```sql
-- 0095_formato_auto.sql — sin funciones. Mismo CASE anidado que 0040/0074, más 'AUTO'.
alter table public.disciplines
  drop constraint disciplines_formato_default_kind,
  add constraint disciplines_formato_default_kind check (
    case formato_default ->> 'kind'
      when 'AUTO' then true
      when 'ROUND_ROBIN' then true
      when 'GROUPS_KNOCKOUT' then
        case
          when (formato_default ->> 'groups') ~ '^[0-9]+$'
           and (formato_default ->> 'qualifiersPerGroup') ~ '^[0-9]+$'
          then (formato_default ->> 'groups')::int in (2, 4)
           and (formato_default ->> 'qualifiersPerGroup')::int = 2
          else false
        end
      else false
    end);
alter table public.matchdays
  drop constraint matchdays_formato_kind,
  add constraint matchdays_formato_kind check (
    case formato ->> 'kind'
      when 'AUTO' then true
      when 'ROUND_ROBIN' then true
      when 'GROUPS_KNOCKOUT' then
        case
          when (formato ->> 'groups') ~ '^[0-9]+$'
           and (formato ->> 'qualifiersPerGroup') ~ '^[0-9]+$'
          then (formato ->> 'groups')::int in (1, 2, 4)
           and (formato ->> 'qualifiersPerGroup')::int = 2
          else false
        end
      else false
    end),
  -- `AUTO` se resuelve al confirmar el armado (`openMatchday`): una fecha nunca sale de DRAFT en AUTO.
  add constraint matchdays_formato_auto_draft check (formato ->> 'kind' <> 'AUTO' or status = 'DRAFT');
```

```sql
-- 0096_matchdays_match_format.sql — sin funciones
alter table public.matchdays
  add column match_format jsonb,
  add constraint matchdays_match_format_shape check (
    case
      when match_format is null then true
      when jsonb_typeof(match_format) <> 'object' then false
      else match_format - 'setsToWin' - 'gamesPerSet' = '{}'::jsonb
       and coalesce((match_format ->> 'setsToWin') ~ '^[1-9]$', false)
       and coalesce((match_format ->> 'gamesPerSet') ~ '^[1-9][0-9]?$', false)
    end);
-- Los rangos por deporte los valida la app (`sportFormatError`): la base no conoce deportes (0093).
grant update (match_format) on public.matchdays to authenticated;
```

```sql
-- 0097_matchdays_match_format_immutable_after_draft.sql — UNA función (molde de 0045)
create or replace function public.matchdays_match_format_immutable_after_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.match_format is distinct from old.match_format and old.status <> 'DRAFT' then
    raise exception 'A cuánto se juega la fecha sólo se cambia con la fecha en armado.';
  end if;
  return new;
end;
$$;

create trigger matchdays_match_format_immutable_after_draft
  before update on public.matchdays
  for each row execute function public.matchdays_match_format_immutable_after_draft();
```

- [ ] **Step 4:** `npx supabase migration up` (base local), `npm run db:types` → `git diff db/database.types.ts` muestra `match_format` y nada más inesperado; se commitea.
- [ ] **Step 5:** `npm test -- db/migrations.unit.test.ts` verde (0094–0096 sin funciones, 0097 con una).
- [ ] **Step 6: gates + commit** — `feat(db): disciplinas de cualquier deporte, AUTO sólo en armado y formato de partido por fecha`

---

### Task 3: El torneo lee cualquier deporte del registro (tipos, slug, etiquetas, guardas)

**Files:** Modify `core/discipline-slug.ts:6,31` (+ `core/discipline-slug.test.ts`), `core/sports.ts` (`sportFormatError`), `db/read.ts:35,175,285,724`, `db/season.ts:235,382-399`, `db/discipline.ts:323,369`, `db/test/factories.ts:9`, `app/torneo/[id]/page.tsx:178`, `[disciplina]/jugador/[entryId]/page.tsx:209`, `[disciplina]/stats/page.tsx:239`, `[disciplina]/ajustes/page.tsx:90,224`, `ajustes/page.tsx:121,146,301`, `reglas/page.tsx:65,92`, `ajustes/disciplinas.tsx:12,208`; Test `db/torneos-deportes.db.test.ts` (+), `core/sports.test.ts` (+)
**Est.:** ~220 líneas. **Ningún test existente cambia.**

**Interfaces — Consumes:** `isTournamentSport`, `sportLabel`, `sportOf` (Tarea 1). **Produces:**

```typescript
DisciplineHeader.kind: string          // antes 'PADEL' | 'FIFA'; un id fuera del registro se lee igual
PublicFormat.kind: string
SluggableDiscipline.kind: string
NewSeasonDiscipline.kind?: TournamentSport   // db/season.ts
NewDiscipline.kind?: TournamentSport         // db/discipline.ts
DisciplineSpec.kind?: string                 // db/test/factories.ts (andamiaje: deja crear 'TEJO')

/** null si el formato de partido entra en la ficha. Sólo mira deportes de sets con `openScore: false`:
 *  los de goles y los marcadores abiertos no tienen perillas (y tests de hoy crean FIFA con la config de pádel,
 *  `db/discipline.db.test.ts:570`). Mensajes: 'Elegí un deporte de la lista.' (id fuera del registro),
 *  `Los sets para ganar tienen que estar entre ${min} y ${max}.`,
 *  `Los ${unit} por set tienen que estar entre ${min} y ${max}.` (o `Los ${unit} por set son ${min}.` si es fijo). */
export function sportFormatError(kind: string, format: Pick<MatchFormat, 'setsToWin' | 'gamesPerSet' | 'openScore'>): string | null
```

- Slug: `discipline.kind.toLowerCase().replaceAll('_', '-')` (`core/discipline-slug.ts:31`). `padel`, `fifa`, `padel-2` no cambian; el redirect 308 (`db/legacy-fecha-redirect.ts:68`) usa la misma función.
- Etiquetas: cada `DISCIPLINE_LABELS[x.kind]` de las pantallas listadas pasa a `sportLabel(x.kind)` (mismo texto para PADEL/FIFA; un id desconocido se muestra tal cual). `DISCIPLINE_LABELS` sigue existiendo para el wizard viejo hasta la Tarea 16.
- Guardas en el loop de validación de `createSeason` (`db/season.ts:382`, ANTES de cualquier escritura) y al principio de `addDiscipline` (`db/discipline.ts:369`): `if (!isTournamentSport(kind)) throw new EdgeError('Elegí un deporte de la lista.')`; `const problem = sportFormatError(kind, spec.config.matchFormat); if (problem !== null) throw new EdgeError(problem)`.

- [ ] **Step 1: tests que fallan:**
  - `core/discipline-slug.test.ts` (+): `[PADEL, PING_PONG, PING_PONG, FIFA]` → `padel`, `ping-pong`, `ping-pong-2`, `fifa`; `resolveDisciplineBySlug(…, 'ping-pong')` encuentra la primera; `'ping_pong'` → `undefined`.
  - `core/sports.test.ts` (+): `sportFormatError('PADEL', { setsToWin: 4, gamesPerSet: 4, openScore: false }) === 'Los sets para ganar tienen que estar entre 1 y 3.'`; `('PADEL', {1, 10, false})` → `'Los games por set tienen que estar entre 3 y 9.'`; `('PING_PONG', {2, 12, false})` → `'Los puntos por set son 11.'`; `('FIFA', {1, 4, false})` → `null`; `('TEJO', …)` → `'Elegí un deporte de la lista.'`.
  - `db/torneos-deportes.db.test.ts` (+): `createSeason(admin.client, { …, disciplines: [{ kind: 'TEJO' as never, config }] })` y `kind: 'FUTBOL' as never` → `EdgeError('Elegí un deporte de la lista.')` y **ninguna fila nueva en `seasons`** de ese usuario; `addDiscipline` con `'TEJO'` → mismo mensaje, `disciplines` sin fila nueva; una disciplina `'TEJO'` creada por la factory → `seasonHeader(admin.client, seasonId)` no tira y trae `kind: 'TEJO'`.
- [ ] **Step 2–4:** FAIL → implementar → gates. `rg -n "'PADEL' \| 'FIFA'" -g '!*.test.ts' -g '!database.types.ts'` → sólo `app/torneos/nuevo/wizard-state.ts` (wizard viejo).
- [ ] **Step 5: commit** — `refactor(torneo): las disciplinas son cualquier deporte del registro, con slug y etiqueta de la ficha`

---

### Task 4: `AUTO` y "a cuánto se juega esta fecha" del lado del servidor

**Files:** Modify `core/types.ts`, `core/config.ts`, `core/knockout.ts:421`, `core/index.ts`, `db/read.ts:194-217,238-246,322-337` (+ columnas de los selects de `matchdays`), `db/discipline.ts:32,68,232-247`, `db/matchday.ts:110-133,300-361,764-857,1214-1250,1742-1757` (+ `setMatchFormat` nuevo), `app/format.ts:68`, `app/torneo/[id]/[disciplina]/fechas/[n]/armado-state.ts:136-176`, `fechas/[n]/page.tsx:292,362`, `fechas/page.tsx:76,110`, `fechas/[n]/actions.ts:420` (+ `changeMatchFormat`), `ajustes/formato-default.tsx` (tipo del prop); Test `core/knockout.test.ts`, `core/config.test.ts`, `armado-state.unit.test.ts` (+), `db/torneos-deportes.db.test.ts` (+)
**Est.:** ~380 líneas (código ~170, tests ~210).

**Interfaces — Consumes:** `MatchdayFormatSetting` (T1), columnas de T2, `sportFormatError` (T3). **Produces:**

```typescript
// core/types.ts
export interface MatchFormatOwn { readonly setsToWin: number; readonly gamesPerSet: number }

// core/config.ts — LA regla de §7: nadie lee el formato de la disciplina directo para una fecha.
export function effectiveMatchFormat(base: MatchFormat, own: MatchFormatOwn | null): MatchFormat
//   own === null ? base : { ...base, setsToWin: own.setsToWin, gamesPerSet: own.gamesPerSet }
//   ponytail: con fechas a distinta cantidad de sets, el desempate por diferencia de sets mezcla
//   fechas distintas (spec §7, aceptado). Si molesta: desempatar por fecha.

// core/knockout.ts
export function resolveFormato(setting: MatchdayFormatSetting, headcount: number, sideSize: SideSize, maxMatches: number): MatchdayFormat
//   setting.kind === 'AUTO' ? suggestFormat(headcount, sideSize, maxMatches) : setting

// db/read.ts
MatchdaySummary.formato: MatchdayFormatSetting      // DRAFT puede ser AUTO; OPEN/CLOSED nunca (0095)
MatchdaySummary.matchFormat: MatchFormatOwn | null   // `matchdays.match_format`
DisciplineHeader.formatoDefault: MatchdayFormatSetting
// db/discipline.ts
DisciplineConfigRow.formatoDefault: MatchdayFormatSetting
updateDisciplineFormatoDefault(supabase, disciplineId, formato: MatchdayFormatSetting)

// db/matchday.ts
setMatchdayFormat(supabase, matchdayId, formato: MatchdayFormatSetting)   // AUTO no pasa por formatoOfrecible
/** Escribe o borra (`null` = "como el torneo") el formato propio de una fecha en DRAFT. */
export async function setMatchFormat(supabase: Client, matchdayId: string, own: MatchFormatOwn | null): Promise<void>

// app/format.ts
matchdayFormatLabel(formato: MatchdayFormatSetting)   // AUTO → 'Automático'

// fechas/[n]/actions.ts
export async function changeMatchFormat(seasonId: string, matchdayId: string, matchdayNumber: number, own: MatchFormatOwn | null): Promise<WriteResult>   // vía inDraft
```

Cambios de comportamiento, uno por lector (lo que hoy lee `config.matchFormat` para una fecha):

| lector | hoy | pasa a |
|---|---|---|
| `matchdayContextFor` (`db/matchday.ts:110`) → `closeMatchday` `:1282`, `advancePhase` | `config` de la disciplina | `config` con `matchFormat: effectiveMatchFormat(config.matchFormat, matchday.match_format)` — un solo lugar para todo el servidor |
| `matchFormatOf` (`:1742`) → `saveResult` `:1417` | `config.matchFormat` | `effectiveMatchFormat(config.matchFormat, matchday.match_format)` |
| `fechas/[n]/page.tsx:362` → tabla del día `:432`, carga `:652,:940`, notas `:708,:725` | `disciplineOf(…).config` | `{ ...config, matchFormat: effectiveMatchFormat(config.matchFormat, matchday.matchFormat) }` |
| `fechas/page.tsx:76,110` (récord del campeón) | `discipline.config.matchFormat` | el efectivo de **cada** fecha |
| `generatePairs` (`:793,:812,:847`) | `matchday.formato` | `resolveFormato(matchday.formato, present.length, pairSize, maxMatchesOf(config, pairSize))` en memoria (no escribe) |
| `openMatchday` (`:1214`, las dos ramas) | llama `open_matchday` | ANTES del RPC, un solo `update` (con `count: 'exact'`) de `formato` (resuelto con los presentes, sólo si es AUTO) y `match_format` (el efectivo, sólo si es `null`) |
| `fechas/[n]/page.tsx:292` (`formatoDraft`) | `matchday.formato` | resuelto con los lados ya sorteados (`detail.sides.length × pairSize`) si los hay; si no, `ROUND_ROBIN` para la vista previa |
| `matchdayShape` (`armado-state.ts:136`) | `matchCountForFormat(formato, sides)` | `formato: MatchdayFormatSetting`; cuenta con `resolveFormato(formato, eventualSize, sideSize, maxMatches)` |

`setMatchFormat`: `requireMatchday` → `status !== 'DRAFT'` → `EdgeError('A cuánto se juega la fecha sólo se cambia con la fecha en armado.')`; `own !== null` → leer la disciplina (`kind` + `config`); primero, si `sportFamily(kind) !== 'sets'` o `config.matchFormat.openScore` → `EdgeError('Este deporte no tiene sets que cambiar.')`; después `sportFormatError(kind, { ...config.matchFormat, ...own })`; si la fecha tiene `match_sets` (vuelta a armado con `redraft_matchday`) → `EdgeError('Hay resultados cargados: volvé a sortear la fecha antes de cambiar a cuánto se juega.')`; update `{ match_format: own }` con `count: 'exact'`, `count === 0` → `'No se pudo cambiar: sólo puede hacerlo quien organiza.'`.

- [ ] **Step 1: tests que fallan:**
  - `core/knockout.test.ts`: `resolveFormato({ kind: 'AUTO' }, 8, 1, 36)` `toEqual({ kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 })`; `(AUTO, 8, 2, 15)` → `ROUND_ROBIN`; un concreto vuelve igual (misma referencia); para `headcount` 2..24 y lados 1|2, `formatoOfrecible(resolveFormato(AUTO,…), lados, techo)` es `true`.
  - `core/config.test.ts`: `effectiveMatchFormat(PADEL, null)` es `PADEL`; `(PADEL, { setsToWin: 2, gamesPerSet: 6 })` → `{ setsToWin: 2, gamesPerSet: 6, tieBreak: true, openScore: false }`.
  - `armado-state.unit.test.ts` (it nuevo): `matchdayShape({ confirmed: 8, …, sideSize: 1, formato: { kind: 'AUTO' } }).matches === 16`.
  - `db/torneos-deportes.db.test.ts` (+), armando la fecha como `db/matchday-format.db.test.ts` (plantel, `createMatchday`, asistencia, `generatePairs`):
    1. Pádel (1 set a 4). DRAFT: `setMatchFormat(…, { setsToWin: 1, gamesPerSet: 6 })`; armar y `openMatchday`; `saveResult([6-4])` ok; `saveResult([4-2])` rechaza con el texto de `setError` (`'En un set a 6 games con tie-break, 4-2 no es un resultado posible.'`); cargar todo a 6 y `closeMatchday` cierra.
    2. Rechazos de `setMatchFormat`: `{1, 10}` en Pádel → `'Los games por set tienen que estar entre 3 y 9.'`; en una fecha de FIFA → `'Este deporte no tiene sets que cambiar.'`; con la fecha OPEN → `'A cuánto se juega la fecha sólo se cambia con la fecha en armado.'`; con `match_sets` cargados tras `redraftMatchday` → `'Hay resultados cargados: …'`.
    3. **AUTO punta a punta**: FIFA individual, `updateDisciplineFormatoDefault(AUTO)`; `createMatchday` → `formato` `{ kind: 'AUTO' }`; 8 presentes; `generatePairs` → partidos con `grupo` 1 y 2; `openMatchday` → `formato` = `{ GROUPS_KNOCKOUT, 2, 2 }`, `match_format` = `{ setsToWin: 1, gamesPerSet: 4 }` (el de la disciplina, congelado).
    4. **"Valen desde la próxima fecha"**: fecha Pádel OPEN (con `match_format` congelado a 4); `updateDisciplineConfig` a `gamesPerSet: 6`; `saveResult([4-2])` en esa fecha sigue ok y cierra.
    5. `setMatchdayFormat(…, { kind: 'AUTO' })` en DRAFT ok, con 12 de a uno (donde `ROUND_ROBIN` se rechaza, `db/matchday-format.db.test.ts:395`).
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Tests existentes que cambian a propósito:** sólo fixtures de tipo — `matchFormat: null` en los `MatchdaySummary` armados a mano de `app/torneos/page.unit.test.ts` y `app/torneo/[id]/[disciplina]/fechas/[n]/page.unit.test.ts` (sin cambiar un solo assert). Si `tsc` pide algo más, es que el cambio se pasó de alcance.
- [ ] **Step 5: commit** — `feat(fecha): AUTO se resuelve al confirmar y cada fecha se juega a su propio formato`

---

### Task 5: Unidades y palabras desde la ficha (+ el corte del Masters)

**Files:** Modify `core/narrate.ts:15-48,195-209,339-341` (+ `narrateRules` interno), `core/index.ts:197`, `fechas/campeon-de-la-fecha.ts:14,30,72`, `fechas/[n]/tabla-desempate.ts:35-55`, `fechas/[n]/page.tsx:708,725`, `fechas/page.tsx:110`, `fechas/[n]/armado-state.ts` (+ `armadoWords`), `fechas/[n]/armado.tsx:69-138,535-581,1009-1120`, `jugador/[entryId]/page.tsx:365`, `stats/page.tsx:191,364,409,416`, `tabla-state.ts` (+ `mastersCutoffFor`), `tabla-view.tsx:151`, `ajustes/page.tsx:144-151`, `reglas/rules-body.tsx:47`, `app/torneos/nuevo/wizard-state.ts:1210` (wizard viejo, para compilar)
**Est.:** ~340 líneas.

**Interfaces — Consumes:** `unitOf`, `sideWords` (T1). **Produces** (todas con `unit` = `unitOf(kind, format)` que pone quien llama):

```typescript
export function formatLabel(format: MatchFormat, unit: string): string
//   openScore → 'Marcador de goles'; setsToWin 1 → `1 set a ${g} ${unit}`; n → `mejor de ${2n-1} sets a ${g} ${unit}`
export function formatsLabel(rows: readonly { label: string; matchFormat: MatchFormat; unit: string }[]): string
export function scoreDiffLabel(unit: string): string    // 'goles' → 'diferencia de gol'; si no `diferencia de ${unit}`
export function bracketOrderNote(unit: string): string
// `scoreUnit` se borra: sus llamadores usan `unitOf`.
championRecord(matches, champion, format, allowsDraw, unit: string)   // `… · +4 ${unit}`
tiebreakNote(standings, config, nameOf, sideSize, unit: string)
// tabla-state.ts
export function mastersCutoffFor(hasMasters: boolean, rowCount: number): number   // hasMasters ? MASTERS_SIZE : rowCount + 1
// armado-state.ts — el `words()` de armado.tsx:102, movido y exportado para poder testearlo
export function armadoWords(sideSize: SideSize, formato: MatchdayFormat, formatDrifted: boolean): ArmadoWords
//   ArmadoWords = el objeto de hoy + `guestPairSection: boolean` (false con sideSize 1) + `guestPartner: boolean` (false con sideSize 1)
```

`narrateRules` (se adapta en la Tarea 7) llama `scoreDiffLabel(format.openScore ? 'goles' : 'games')` y conserva su salida byte a byte.

Pantallas:
- `stats/page.tsx`: `unit = unitOf(discipline.kind, discipline.config.matchFormat)`; `Games totales` → `` `${cap(unit)} totales` ``, `Games a favor` → `` `${cap(unit)} a favor` ``; "Mejor dupla del torneo" y "Con quién te va bien" sólo con `pairSize === 2 && !fixedTeams` (`fixedTeams` de `disciplineConfig`, `db/discipline.ts:50`); la frase de `:191` deja de nombrar "la mejor dupla" cuando no aplica. `cap` = primera letra en mayúscula, inline.
- `jugador/[entryId]/page.tsx:365`: `` `Dif. ${unit}` ``.
- `tabla-view.tsx:151`: `mastersCutoff={mastersCutoffFor(discipline.hasMasters, rows.length)}` (bug §8: FIFA individual decía "CLASIFICAN AL MASTERS").
- `armado.tsx`: con `sideSize === 1` no se dibuja la sección de invitados en pareja (`:535-581`, incluye "+ Agregar 2 invitados") ni el "Juega con" de `GuestCard` (`:1061-1095`); la nota del invitado dice `'Juega solo y no suma puntos para el campeonato. Va al final del orden: nadie sabe cómo juega.'`.

- [ ] **Step 1: tests que fallan:**
  - `core/narrate.test.ts`: `formatLabel(SPORTS.PING_PONG.format, 'puntos') === 'mejor de 3 sets a 11 puntos'`; `formatLabel({ ...PADEL, setsToWin: 2, gamesPerSet: 6 }, 'games') === 'mejor de 3 sets a 6 games'`; `scoreDiffLabel('puntos') === 'diferencia de puntos'`, `('goles') === 'diferencia de gol'`; `bracketOrderNote('puntos')` contiene `'diferencia de puntos'`.
  - `campeon-de-la-fecha.unit.test.ts` (it nuevo): ping pong `[11-5]` → `'1–0 · +6 puntos'`.
  - `tabla-desempate.unit.test.ts` (it nuevo): con `unit 'puntos'` la nota dice `diferencia de puntos`.
  - `tabla-state.unit.test.ts`: `mastersCutoffFor(true, 8) === 4`; `mastersCutoffFor(false, 8) === 9`.
  - `armado-state.unit.test.ts`: `armadoWords(1, RR, false).guestPairSection === false`, `.guestPartner === false`; con `2` los dos `true` y `sides === 'parejas'` (texto de hoy).
  - `stats/page.unit.test.ts` (it nuevo): FIFA de a uno → sin `Mejor dupla del torneo`, con `Goles totales`.
  - `jugador/[entryId]/page.unit.test.ts` (it nuevo): slug `fifa` → `Dif. goles`.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador:** un torneo FIFA individual y uno de Pádel (crearlos con el wizard viejo, que sigue vivo): tabla de FIFA sin "CLASIFICAN AL MASTERS"; stats y jugador de FIFA dicen "goles" y sin "Mejor dupla"; armado de FIFA de a uno sin "+ Agregar 2 invitados" ni "Juega con"; Pádel idéntico a antes (captura antes/después del armado de Pádel).
- [ ] **Tests existentes que cambian a propósito:**
  - copy: `core/narrate.test.ts:362` (`'3 sets a 4 games'` → `'mejor de 5 sets a 4 games'`).
  - firma, mismo texto esperado: `core/narrate.test.ts` (llamadas a `formatLabel`/`formatsLabel`/`bracketOrderNote`, `:358-454`), `campeon-de-la-fecha.unit.test.ts` (11 llamadas a `championRecord` + `'games'`/`'goles'`), `tabla-desempate.unit.test.ts` (7 llamadas a `tiebreakNote`).
  - mock nuevo: `stats/page.unit.test.ts` agrega `vi.mock('@/db/discipline')` con `disciplineConfig` → `fixedTeams: false`.
- [ ] **Step 6: commit** — `feat(torneo): cada pantalla habla con la unidad y las palabras del deporte`

---

### Task 6: El reglamento en criollo (una sola función)

**Files:** Create `core/reglamento.ts`, `core/reglamento.test.ts`; Modify `core/index.ts`
**Est.:** ~280 líneas (código ~120, tests ~160). **Ningún test existente cambia.**

**Interfaces — Consumes:** `modalityOf`, `modalityLabel`, `unitOf`, `sideWords` (T1), `MatchdayFormatSetting`, `MASTERS_SIZE`. (`matchdayFormatLabel` vive en `app/format.ts` y `core/` no importa `app/`: los nombres de formato de la fecha se escriben acá.) **Produces:**

```typescript
export interface ReglamentoInput {
  kind: string
  pairSize: SideSize
  fixedTeams: boolean
  hasMasters: boolean
  allowsDraw: boolean
  formatoDefault: MatchdayFormatSetting
  config: SeasonConfig
}
export type ReglamentoKey = 'modalidad' | 'partido' | 'fecha' | 'puntos' | 'temporada' | 'desempate' | 'masters'
export interface ReglamentoLine { key: ReglamentoKey; text: string }
/** El reglamento de UNA disciplina. Lo usan el paso 4 del wizard, "Así queda" de la hoja y Reglas: nunca dicen cosas distintas (spec §6). */
export function reglamento(input: ReglamentoInput): ReglamentoLine[]
/** La frase de desempate, compartida con la ayuda del stepper "Desempate" de la hoja. */
export function desempateLine(every: number): string
/** La ficha en una línea, para la tarjeta del paso 3. */
export function fichaLine(input: ReglamentoInput): string
```

Textos exactos (el orden de las líneas es el de abajo; `masters` sólo con `hasMasters`):

| key | regla | ejemplo |
|---|---|---|
| `modalidad` | `${modalityLabel}.` + si hay `firstFecha`: ` La primera fecha se arma ${NIVEL ? 'por nivel' : 'al azar'}; después, por la tabla.` | `Parejas que rotan. La primera fecha se arma por nivel; después, por la tabla.` |
| `partido` | sets, 1: `Partidos a 1 set de ${g} ${unit}`; n: `Partidos al mejor de ${2n-1} sets de ${g} ${unit}`; + `, se gana por 2` sin tie-break; + `.` — goles: `Partidos a goles; se puede empatar.` / `Partidos a goles, siempre con un ganador.` | `Partidos al mejor de 3 sets de 11 puntos, se gana por 2.` |
| `fecha` | `AUTO`: `Cada fecha se arma sola, según cuántos vengan.` · `ROUND_ROBIN`: `Cada fecha, todos contra todos.` · grupos: `Cada fecha, ${g} grupos + llave.` | |
| `puntos` | `Gana ${p[0]}` + `, ${ordinal} ${p[i]}` por cada valor > 0 + si hay cola de ceros `; del ${ordinal(primer 0)} para abajo no suman` + `.` (ordinales: segundo…décimo, después `11°`) | `Gana 10, segundo 7, tercero 5, cuarto 3, quinto 2, sexto 1; del séptimo para abajo no suman.` |
| `temporada` | `${R} fechas, cuentan las ${C} mejores.` (C === R: `${R} fechas, cuentan todas.`; R === 1: `1 fecha.`) | `10 fechas, cuentan las 8 mejores.` |
| `desempate` | `desempateLine(n)`: n 1 → `Si empatan en puntos, gana el que iba mejor la fecha anterior.`; n → `Si empatan en puntos, gana el que iba mejor hace ${n} fechas.` | |
| `masters` | `Masters al final con los ${MASTERS_SIZE} mejores.` | |

`fichaLine`: `[formatLabel-corto, `${R} fechas`, `cuentan las ${C} mejores`, hasMasters && 'Masters al final'].join(' · ')` con formato corto `1 set a 4 games` / `Mejor de 3 sets a 11 puntos` / `A goles` → `'1 set a 4 games · 10 fechas · cuentan las 8 mejores · Masters al final'`.

- [ ] **Step 1: tests que fallan** — los tres casos del spec y los bordes, comparando el array entero:
  1. `fichaSeed('PADEL', 8, 'ROTAN')` → las 7 líneas: `Parejas que rotan. La primera fecha se arma por nivel; después, por la tabla.` · `Partidos a 1 set de 4 games.` · `Cada fecha se arma sola, según cuántos vengan.` · `Gana 10, segundo 6, tercero 3, cuarto 1.` · `10 fechas, cuentan las 8 mejores.` · `Si empatan en puntos, gana el que iba mejor hace 3 fechas.` · `Masters al final con los 4 mejores.` (es el párrafo de §6, en presente).
  2. `fichaSeed('PING_PONG', 6, 'INDIVIDUAL')` → `Individual. La primera fecha se arma al azar; después, por la tabla.` · `Partidos al mejor de 3 sets de 11 puntos, se gana por 2.` · … · `Gana 10, segundo 7, tercero 5, cuarto 3, quinto 2, sexto 1.` · sin `masters`.
  3. FIFA individual 8 → `Partidos a goles; se puede empatar.` y la cola de ceros.
  4. **Torneo existente**: Pádel con `defaultConfig(8)` (sin `firstFecha`), `ROUND_ROBIN`, `fixedTeams false` → `modalidad === 'Parejas que rotan.'`, `fecha === 'Cada fecha, todos contra todos.'`.
  5. `kind: 'TEJO'`, `pairSize 2`, `fixedTeams true` → `Parejas fijas.` (nunca tira). Ping pong `FIJAS` → `Dobles fijos. …`.
  6. Bordes: `countBestOf === regularMatchdays`; `tiebreakSnapshotEvery 1`; grupos 4; `[10, 0, 0]` → `Gana 10; del segundo para abajo no suman.`
  7. `fichaLine` de Pádel / Ping pong / FIFA.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: commit** — `feat(core): el reglamento en criollo de una disciplina, una sola función`

---

### Task 7: La página Reglas: el reglamento arriba, el detalle de hoy debajo

> **Decisión del dueño (2026-10-14):** el reglamento en criollo va ARRIBA; el acordeón detallado
> de hoy (cómo se arman las parejas, desempates dentro de la fecha, invitados, Masters) se QUEDA
> debajo, cerrado, bajo "Más detalle". No se borra nada; se ajusta para que no contradiga al
> reglamento.

**Files:** Create `supabase/migrations/0098_season_public_formats_modalidad.sql`; Modify `core/types.ts:79-83` (`DisciplineShape`), `core/narrate.ts:69-184,227-280` (`narrateRules`), `db/read.ts:174-186,719-733`, `db/database.types.ts`, `app/torneo/[id]/reglas/page.tsx`, `reglas/rules-body.tsx` (`ROWS`/`sectionApplies` `:28-91`); Tests `core/narrate.test.ts`, `db/public-formats.db.test.ts`, `reglas/rules-body.unit.test.ts`, `app/cableado-de-formato.unit.test.ts`
**Est.:** ~330 líneas (página ~120, `narrateRules` ~40, migración ~30, tests ~140). Nada se borra.

**Interfaces — Consumes:** `reglamento` (T6), `sportLabel`, `unitOf` (T1), `scoreDiffLabel(unit)`/`formatsLabel` con unidad (T5). **Produces:**

```typescript
PublicFormat.fixedTeams: boolean
PublicFormat.formatoDefault: MatchdayFormatSetting
// core/types.ts — DisciplineShape gana un campo OBLIGATORIO (mismo criterio que sus otros tres):
  fixedTeams: boolean
// core/narrate.ts — la unidad la pone quien llama (`unitOf(kind, config.matchFormat)`):
export function narrateRules(config: SeasonConfig, shape: DisciplineShape, unit: string): RulesSection[]
// reglas/rules-body.tsx
export interface RulesBlock {
  label: string
  lines: ReglamentoLine[]      // arriba
  config: SeasonConfig         // para el acordeón de "Más detalle"
  shape: DisciplineShape
  unit: string
  text: string
}
```

Ajustes a `narrateRules` para que el detalle nunca diga otra cosa que el reglamento de arriba:
- `describeFormat` (`core/narrate.ts:279`): `` `de ${format.gamesPerSet} ${unit}` `` en vez de `games` fijo; `describeTiebreak` usa `scoreDiffLabel(unit)` (en la Tarea 5 quedó con la unidad derivada de `openScore`).
- "La fecha" (`:104-107`): la frase de lados deja de afirmar "y juegan todos contra todos" (cómo se arma la fecha lo dice la línea `fecha` del reglamento, y con `AUTO` o grupos era falso): individual → `'Cada uno juega por su cuenta. '`; parejas que rotan → `'Se arman parejas con todos. '`; parejas fijas → `'Cada pareja juega junta todo el torneo. '`. La cláusula de invitados (`:108-112`) no cambia.
- "Cómo se arman las parejas" (`:155-165`) sólo con `pairSize === 2 && !fixedTeams` — en el `if` de `narrateRules` **y** en `sectionApplies` de `rules-body.tsx` (el mismo predicado, como hoy).
- La fila "Formato de partido" del acordeón usa `formatsLabel` con la unidad.

```sql
-- 0098 — UNA función. Mismo drop+create que 0069 (cambiar `returns table` pide drop, y el drop se
-- lleva los grants: se re-otorgan abajo). Suma dos reglas de juego a lo público: si la pareja
-- rota o es fija, y cómo se arma cada fecha. Nada de identidad (`id`, `season_id`, `position`).
drop function if exists public.season_public_formats(uuid);
create function public.season_public_formats(p_season uuid)
returns table (
  kind text, config jsonb, rules_text text, has_masters boolean, pair_size int,
  allows_draw boolean, fixed_teams boolean, formato_default jsonb
)
language sql stable security definer set search_path = ''
as $$
  select d.kind, d.config, d.rules_text, d.has_masters, d.pair_size, d.allows_draw,
         d.fixed_teams, d.formato_default
    from public.disciplines d
   where d.season_id = p_season
   order by d.position, d.created_at
$$;
revoke execute on function public.season_public_formats(uuid) from public;
grant  execute on function public.season_public_formats(uuid) to anon, authenticated;
```

Página: las dos ramas leen `publicFormats` (la con sesión además `seasonHeader` para `isAdmin` y
`seasonAdminName`). Un bloque por deporte (tarjeta de amigos), **siempre** con su título
(`sportLabel`, `text-[17px] font-extrabold`), y adentro, en este orden:
1. el reglamento como un párrafo (`lines.map((l) => l.text).join(' ')`);
2. "Reglas de la casa" (`renderAdminMarkdown(text)`, sólo si hay texto);
3. `<details>` **cerrado** con `<summary>` "Más detalle" (44px de alto, `text-accent-link
   font-extrabold`, marcador ›/⌄ propio, foco visible) y adentro el `RulesAccordion` de hoy
   (`reglas/accordion.tsx`, sin cambios) con las filas de `narrateRules(config, shape, unit)`.

Al final, una vez: `Alguna fecha puede jugarse a otra cosa: se avisa en esa fecha.` Se conservan
la intro, "Editar reglas" para admin y "Ir al inicio".

- [ ] **Step 1: tests que fallan:**
  - `core/narrate.test.ts` (+): parejas fijas → sin sección `Cómo se arman las parejas` y `La fecha` con `Cada pareja juega junta todo el torneo.`; ping pong (`unit 'puntos'`) → `La fecha` dice `de 11 puntos` y `Los desempates` `diferencia de puntos`; ninguna forma de disciplina dice `todos contra todos` en `La fecha`.
  - `db/public-formats.db.test.ts:131-150` (a propósito): `'devuelve OCHO columnas y nada más'` → las seis + `'fixed_teams'`, `'formato_default'`; + it: una disciplina `fixed_teams` con `formato_default` AUTO las devuelve así a `anon`.
  - `rules-body.unit.test.ts` (reescrito): Pádel + FIFA → dos títulos; el párrafo de §6 con "se arma" ANTES de `<details>`; `<details>` sin atributo `open` y con `<summary>Más detalle</summary>`; adentro las filas de hoy (`Cómo se arman las parejas` para Pádel rotan, no para FIFA individual ni para parejas fijas; `Orden de desempate`, la cláusula de invitados); texto libre escapado (`<script>` no pasa); la línea fija una sola vez; con un solo deporte el título igual aparece. **Review Focus 3:** un torneo existente (Pádel `defaultConfig(8)`, `ROUND_ROBIN`) sin la frase de primera fecha.
  - `app/cableado-de-formato.unit.test.ts` — los describes `'Reglas con sesión…'` (`:198-260`) y `'Reglas SIN SESIÓN…'` (`:684-720`): las dos ramas mockean `publicFormats`; cada bloque narra su disciplina (reglamento arriba, su acordeón en "Más detalle") y su texto.
- [ ] **Step 2:** FAIL. **Step 3:** migración (`migration up`, `db:types`), `DisciplineShape.fixedTeams`, `narrateRules` con unidad, página.
- [ ] **Step 4:** gates (+ `migrations.unit.test.ts`).
- [ ] **Step 5: navegador** (390px, claro/oscuro): Reglas de un torneo Pádel + FIFA con sesión y en ventana sin sesión (el link): dos bloques, mismos textos en las dos; "Más detalle" cerrado al entrar, se abre con toque y con teclado (Enter/Espacio); un torneo existente del seed sin la frase de primera fecha. Capturas con "Más detalle" cerrado y abierto.
- [ ] **Tests existentes que cambian a propósito:**
  - `core/narrate.test.ts`: copy — los pines de byte-identidad de `La fecha` (`:29-106`, `:227-320`) pierden "y juegan todos contra todos" (`'Se arman parejas con todos. '` / `'Cada uno juega por su cuenta. '`); fixture de tipo — `fixedTeams: false` en cada `DisciplineShape` armado a mano; firma — `narrateRules(…, unit)` con `'games'`/`'goles'` (resto del texto esperado igual).
  - `db/public-formats.db.test.ts` (seis → ocho columnas), `reglas/rules-body.unit.test.ts` (reescrito), los dos describes de Reglas de `app/cableado-de-formato.unit.test.ts`.
- [ ] **Step 6: commit** — `feat(reglas): el reglamento en criollo arriba y el detalle de siempre en "Más detalle"`

---

### Task 8: La hoja "Personalizar reglas"

**Files:** Create `app/stepper.tsx`, `app/deporte/personalizar-reglas-state.ts`, `app/deporte/personalizar-reglas.tsx`, `app/deporte/personalizar-reglas.unit.test.ts`; Modify `app/torneos/nuevo/wizard.tsx:259-282` (el `Stepper` se muda: `import { Stepper } from '@/app/stepper'`), `app/amigos/[playerId]/resultado-sets.tsx:12` (mismo import)
**Est.:** ~420 líneas (state ~110, componente ~230, tests ~80). Todavía no la monta nadie.

**Interfaces — Consumes:** `fichaSeed`, `modalityLabel`, `sideWords`, `unitOf`, `SPORTS` (T1), `resolveFormato` (T4), `formatLabel` (T5), `desempateLine`, `reglamento` (T6), `matchCountForFormat`, `MASTERS_SIZE`, `maxMatchesOf`, `formatErrors` (`wizard-state.ts:1159`, se queda). **Produces:**

```typescript
// personalizar-reglas-state.ts
export interface DisciplineRules { config: SeasonConfig; hasMasters: boolean; formatoDefault: MatchdayFormatSetting }
export function rulesFromSeed(seed: DisciplineSeed): DisciplineRules
export type FormatoChoice = 'AUTO' | 'ROUND_ROBIN' | 'GROUPS_KNOCKOUT'
export function formatoChoice(setting: MatchdayFormatSetting): FormatoChoice
export function withFormatoChoice(rules: DisciplineRules, choice: FormatoChoice): DisciplineRules   // GROUPS_KNOCKOUT → groups 2
export interface RulesHints {
  setsToWin: string; gamesPerSet: string; formato: string; points: string; maxMatches: string
  regularMatchdays: string; countBestOf: string; masters: string; tiebreak: string
}
export function rulesHints(kind: string, rules: DisciplineRules, pairSize: SideSize): RulesHints
export function rulesErrors(rules: DisciplineRules, pairSize: SideSize): string[]   // = formatErrors(rules.config, pairSize)

// personalizar-reglas.tsx ('use client')
export function BloquePartido(props: {
  kind: string; format: MatchFormat; disabled: boolean; onChange: (next: MatchFormat) => void
}): JSX.Element   // también lo usa el armado (Tarea 17)
export function PersonalizarReglas(props: {
  kind: string; modality: Modality; pairSize: SideSize; rules: DisciplineRules
  /** "Volver a las reglas de X". `null` = el deporte no tiene ficha: no hay a qué volver. */
  ficha: DisciplineRules | null
  /** Junto a "Listo" (Ajustes pone el aviso de §5). */
  note: string | null
  pending: boolean
  error: string | null
  onChange: (next: DisciplineRules) => void
  onDone: () => void
  onClose: () => void
}): JSX.Element
```

Ayudas exactas (`rulesHints`, todas con test):
- `setsToWin`: `` `${n} = ${frase(n)}.` `` + si `n+1 ≤ max`: `` ` ${n+1} = ${frase(n+1)}.` ``; `frase(1)='un solo set'`, `frase(k)=` `` `al mejor de ${2k-1}` `` → `'1 = un solo set. 2 = al mejor de 3.'`.
- `gamesPerSet`: tie-break → `` `Con tie-break: el set termina en ${g} justo.` ``; sin → `` `Se gana por 2: ${g}-${g-2}, ${g+1}-${g-1}…` `` → `'Se gana por 2: 11-9, 12-10…'`.
- `formato`: `` `Con ${plantel} jugadores: ${label minúscula de resolveFormato(…)} (${partidos} partidos). Se puede cambiar al armar cada fecha.` ``
- `points`: `` `Cuántos suma cada puesto de la fecha. Hay un puesto por ${sideWords(pairSize).one}.` ``
- `regularMatchdays`: Masters → `'Sin contar el Masters.'`; individual → `'Sin Masters: en individual no hay.'`; si no → `'Sin Masters.'`
- `countBestOf` (d = fechas − cuentan): 0 → `'Cuentan todas: faltar resta.'`; 1 → `'La peor se descarta: podés faltar 1 vez.'`; d → `` `Las ${d} peores se descartan: podés faltar ${d} veces.` ``
- `masters`: `` `Los ${MASTERS_SIZE} mejores juegan una fecha extra que define el campeón.` ``
- `tiebreak`: `desempateLine(n)` (misma frase que Reglas).
- `maxMatches`: las de hoy (`ajustes/formato.tsx:160-164`).

La hoja (ver mockup): diálogo modal `role="dialog" aria-modal aria-labelledby`, fondo `bg-scrim`, panel
`max-h-[92dvh] overflow-y-auto rounded-t-card bg-bg` pegado abajo (en ≥640px `max-w-lg` centrado y
`rounded-card`), `×` 44px con `aria-label="Cerrar"`, Escape cierra. Título `Reglas de ${label}`,
subtítulo `${modalityLabel} · ${plantel} jugadores`. Tres bloques (rótulo + tarjeta con filas
`border-t border-line`):
- **El partido** (`BloquePartido`): un `Stepper` por eje sólo si `min < max`; lo fijo (11 en ping
  pong) como chip `bg-chip` sin botones; deporte de goles o `openScore`: el bloque no se dibuja.
- **La fecha**: "Cómo se arma" = tres botones `/rapido` (Automático con subtítulo "según cuántos
  vengan", Todos contra todos, Grupos + llave) y, con grupos, segundo renglón `2 grupos · 4
  grupos`; "Puntos por posición" = grilla de mosaicos (`grid grid-cols-4 gap-2`, valor grande +
  `1°` chico; el elegido con borde `border-accent`) y un `Stepper` debajo para el mosaico elegido
  (0–99); "Partidos por fecha" (1–66).
- **La temporada**: Fechas (1–24), Cuentan las mejores (1–fechas), Masters al final (switch
  `role="switch" aria-checked`, **no se dibuja** con `pairSize === 1`), Desempate (1–6).
- Debajo: "Así queda:" + `reglamento(…)` sin la línea `modalidad`, en una tarjeta `bg-surface`;
  los errores de `rulesErrors` como avisos `bg-live-bg`; `note`; botón primario "Listo"
  (deshabilitado con errores o `pending`); link "Volver a las reglas de <deporte>" si `ficha !== null`.

- [ ] **Step 1: tests que fallan** (`personalizar-reglas.unit.test.ts`; `renderToStaticMarkup`):
  - `rulesHints` — cada frase de arriba con Pádel 8 ROTAN y Ping pong 6 INDIVIDUAL; `withFormatoChoice(r, 'GROUPS_KNOCKOUT').formatoDefault` → grupos 2; `formatoChoice({ kind: 'AUTO' }) === 'AUTO'`.
  - Hoja Pádel ROTAN: dos steppers de partido, `Masters al final`, `Así queda:` con `Partidos a 1 set de 4 games.`, `Volver a las reglas de Pádel`.
  - Hoja Ping pong INDIVIDUAL: un solo stepper de partido y el chip `11`; **sin** `Masters al final`; `Sin Masters: en individual no hay.`.
  - Hoja FIFA: sin bloque "El partido".
  - `ficha: null` → sin "Volver a las reglas"; `countBestOf > regularMatchdays` → aviso y "Listo" `disabled`.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5:** sin navegador en esta tarea (nadie la monta todavía): se verifica en la Tarea 12.
- [ ] **Step 6: commit** — `feat(torneo): la hoja "Personalizar reglas" de un deporte`

---

### Task 9: La tarjeta de un deporte (paso 3 y "Agregar un deporte")

**Files:** Create `app/deporte/tarjeta-state.ts`, `app/deporte/tarjeta.tsx`, `app/deporte/tarjeta.unit.test.ts`
**Est.:** ~240 líneas. Todavía no la monta nadie.

**Interfaces — Consumes:** `MODALITY_ORDER`, `modalityLabel`, `SPORTS`, `sportLabel` (T1), `fichaLine` (T6), `DisciplineRules` (T8). **Produces:**

```typescript
// tarjeta-state.ts
export type PrimeraFecha = FirstFecha | { igualQue: string }   // igualQue = kind del otro deporte (o DisciplineId en Ajustes)
export function primeraFechaKey(value: PrimeraFecha): string     // 'NIVEL' | 'SORTEO' | `IGUAL:${id}`
export function offeredModalities(kind: string): Modality[]      // ficha ∩ MODALITY_ORDER, en MODALITY_ORDER

// tarjeta.tsx ('use client')
export function TarjetaDeporte(props: {
  kind: string
  squadSize: number
  modality: Modality
  /** `null`: la modalidad ya está elegida y no se cambia (Ajustes, §5). */
  onModality: ((next: Modality) => void) | null
  primeraFecha: PrimeraFecha
  primeraFechaOptions: readonly { value: PrimeraFecha; label: string; sub: string | null }[]
  onPrimeraFecha: (next: PrimeraFecha) => void
  rules: DisciplineRules
  pairSize: SideSize
  fixedTeams: boolean
  warning: string | null
  onPersonalizar: () => void
}): JSX.Element
```

Visual (mockup paso 3): tarjeta de amigos; arriba nombre del deporte (`text-[17px] font-extrabold`)
y pastilla `${squadSize} jugadores` (`bg-chip rounded-full`); botones de modalidad estilo `/rapido`
en `MODALITY_ORDER`, con `aria-pressed`, envolviendo en dos líneas sin achicar la letra; rótulo
"PRIMERA FECHA" y sus botones (`Por nivel` / sub `las ordenás vos`; `Al azar` / sub `sorteo`;
`Igual que <deporte>` sin sub); la ficha en una línea (`fichaLine`, `text-muted`); link
"Personalizar reglas ›" (`text-accent-link font-extrabold`, 44px de alto); `warning` como aviso.
`fichaLine` recibe `allowsDraw` de `SPORTS[kind]` (`false` fuera del registro); no lo dibuja.

- [ ] **Step 1: tests que fallan:** `offeredModalities('PADEL')` `toEqual(['FIJAS', 'ROTAN'])`; `('PING_PONG')` → los tres; tarjeta Pádel: `Parejas fijas` antes que `Parejas que rotan` y `aria-pressed="true"` en la marcada; Ping pong: `Dobles fijos`; con dos opciones de primera fecha no aparece `Igual que`; con `onModality: null` no hay botones de modalidad y sí el texto `Parejas que rotan · se elige al crear el torneo`; `fichaLine` adentro.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: commit** — `feat(torneo): la tarjeta de un deporte, con modalidad y primera fecha`

---

### Task 10: El estado del wizard nuevo

**Files:** Create `app/torneos/nuevo/crear-state.ts`, `crear-state.unit.test.ts`
**Est.:** ~330 líneas (código ~150, tests ~180).

**Interfaces — Consumes:** `fichaSeed`, `isTournamentSport`, `modalityShape`, `TOURNAMENT_SPORTS` (T1), `DisciplineRules`/`rulesFromSeed` (T8), `PrimeraFecha` (T9), de `wizard-state.ts` (se quedan): `Squad`, `namesAfterEdit`, `removeSeatAt`, `addMySeat`, `addBlankSeat`, `submitSeats`, `filledCount`, `withoutTrailingBlanks`, `squadWarning`, `effectiveFloor`, `resizeConfig`. **Produces:**

```typescript
export interface DeporteElegido {
  kind: TournamentSport
  modality: Modality
  primeraFecha: PrimeraFecha                  // igualQue = otro TournamentSport elegido
  rules: DisciplineRules
  /** Índices sobre `submitSeats(squad).squadNames`. Con FIJAS, índices de PAREJA (sobre `pairs`). Vacío = orden del plantel. */
  order: number[]
  /** Sólo FIJAS. Índices sobre `squadNames`. */
  pairs: Array<[number, number]>
}
/** Toca un chip: agrega la tarjeta (ficha, primera modalidad) al final, o la saca (y quien era "igual que" ella vuelve a su default). */
export function elegirDeporte(cards: readonly DeporteElegido[], kind: TournamentSport, squadSize: number): DeporteElegido[]
/** Reaplica de la ficha lo que depende de la modalidad: puntos, Masters, primera fecha. Lo demás que el usuario tocó se queda. Vacía order y pairs. */
export function cambiarModalidad(card: DeporteElegido, modality: Modality, squadSize: number): DeporteElegido
export function opcionesPrimeraFecha(cards: readonly DeporteElegido[], kind: TournamentSport): { value: PrimeraFecha; label: string; sub: string | null }[]
//   'NIVEL', 'SORTEO' y un `igualQue` por cada OTRA tarjeta que no sea a su vez "igual que" (sin cadenas)
export function cambiarPrimeraFecha(cards: readonly DeporteElegido[], kind: TournamentSport, value: PrimeraFecha): DeporteElegido[]
export function cambiarReglas(cards: readonly DeporteElegido[], kind: TournamentSport, rules: DisciplineRules): DeporteElegido[]
/** "Volver a las reglas de X". */
export function reglasDeFicha(card: DeporteElegido, squadSize: number): DisciplineRules
/** El plantel cambió: puntos al tamaño nuevo (`resizeConfig`) y order/pairs vacíos en todas. */
export function plantelCambio(cards: readonly DeporteElegido[], squadSize: number): DeporteElegido[]
/** Aviso del paso 3: plantel impar con alguna modalidad de parejas (texto de `squadWarning`), o null. */
export function errorDeModalidades(cards: readonly DeporteElegido[], names: readonly string[]): string | null
export type Subpaso = 'PAREJAS' | 'NIVEL'
export function subpasos(cards: readonly DeporteElegido[]): Subpaso[]      // PAREJAS si alguna FIJAS; NIVEL si alguna NIVEL; en ese orden
export function sortearParejas(seats: number, random: () => number): Array<[number, number]>   // shuffled + de a dos
export function parejasCompletas(card: DeporteElegido, seats: number): boolean
/** El input de `createTournament`. */
export function crearPayload(name: string, squad: Squad, cards: readonly DeporteElegido[]): {
  name: string; squadNames: string[]; mySeatIndex: number | null; config: SeasonConfig; disciplines: NewSeasonDiscipline[]
}
```

`crearPayload` por tarjeta: `kind`, `config` (`resizeConfig` al plantel real, con `firstFecha` = el
modo propio o el de la tarjeta "igual que"), `pairSize`/`fixedTeams` de `modalityShape`,
`allowsDraw` (ficha), `hasMasters` (`false` si `pairSize === 1`), `formatoDefault`, y según la
primera fecha: `NIVEL` con `order` → `seedOrder` (con FIJAS, las parejas en ese orden aplanadas);
`SORTEO` → `shuffle: true`; `igualQue` → `sameOrderAs: <índice de esa tarjeta>`; FIJAS con
`pairs` → `teams`. `config` (legado de `NewSeason`) = la de la primera tarjeta. Usa los campos de
`NewSeasonDiscipline` de la Tarea 11 (por eso esta tarea define el tipo de salida con esos
nombres y la 11 los implementa: `seedOrder`, `shuffle`, `sameOrderAs`, `teams`).

- [ ] **Step 1: tests que fallan:**
  1. `elegirDeporte([], 'PADEL', 8)` → una tarjeta `ROTAN`, `NIVEL`, `rules` = `rulesFromSeed(fichaSeed('PADEL', 8, 'ROTAN'))`; tocar FIFA y después Pádel → queda FIFA sola; el orden de las tarjetas es el de los toques.
  2. `cambiarModalidad` de una Pádel con `setsToWin: 2` y `regularMatchdays: 12` tocados a `FIJAS` → conserva `2` y `12`, `firstFecha 'SORTEO'`, `hasMasters true`; FIFA `INDIVIDUAL → ROTAN` con 8 → `points` de 4 lados, `hasMasters false`; `order`/`pairs` vacíos.
  3. `opcionesPrimeraFecha` con una sola tarjeta → sin `igualQue`; con Pádel + Ping pong → Ping pong ofrece `Igual que Pádel`; si Pádel es "igual que Ping pong", Ping pong NO ofrece "igual que Pádel".
  4. `elegirDeporte` sacando la tarjeta de la que otra era "igual que" → la otra vuelve al default de su ficha.
  5. **Review Focus 2:** con `pairs` y `order` armados, `plantelCambio(cards, 7)` → todos vacíos y `points.length` del plantel nuevo.
  6. **Review Focus 5:** `errorDeModalidades([pádel ROTAN], 7 nombres)` → `'Son 7. El plantel tiene que ser par para poder armar parejas.'`; con FIFA individual → `null`.
  7. `subpasos`: Pádel FIJAS + Ping pong NIVEL → `['PAREJAS', 'NIVEL']`; FIFA SORTEO → `[]`.
  8. `sortearParejas(6, random fijo)` → 3 pares disjuntos que cubren 0..5; impar → tira.
  9. `crearPayload`: Pádel ROTAN NIVEL (order `[2,0,1,3]`) + Ping pong INDIVIDUAL "igual que Pádel" → Pádel `seedOrder [2,0,1,3]`, `firstFecha 'NIVEL'`; Ping pong `sameOrderAs: 0`, `firstFecha 'NIVEL'`; Pádel FIJAS con pairs `[[0,3],[1,2]]` y order de parejas `[1,0]` → `teams [[0,3],[1,2]]`, `seedOrder [1,2,0,3]`; FIFA SORTEO → `shuffle: true`, sin `seedOrder`; `squadNames` sin filas en blanco y `mySeatIndex` recalculado (`submitSeats`).
- [ ] **Step 2–4:** FAIL → implementar → gates. (El tipo `NewSeasonDiscipline` todavía no tiene los campos nuevos: en esta tarea el tipo de retorno se declara local en `crear-state.ts` con esos nombres; la Tarea 11 lo reemplaza por `NewSeasonDiscipline`.)
- [ ] **Step 5: commit** — `feat(torneo): el estado del wizard nuevo, desde la ficha`

---

### Task 11: `createSeason`: parejas fijas, sorteo guardado como orden, "igual que"

**Files:** Modify `db/season.ts:234-304` (tipo), `:382-399` (validación), `:589-651` (siembra + equipos), `core/order.ts` (+ `shuffled`), `core/index.ts`, `app/torneos/nuevo/crear-state.ts` (usa el tipo real); Test `core/order.test.ts` (+), `db/season.unit.test.ts` (+), `db/torneos-deportes.db.test.ts` (+)
**Est.:** ~320 líneas. **Ningún test existente cambia** (los campos nuevos son opcionales: sin ellos `createSeason` hace lo de siempre).

**Interfaces — Produces:**

```typescript
// core/order.ts
/** Fisher-Yates sobre una copia. `random` inyectado para poder testearlo. */
export function shuffled<T>(items: readonly T[], random: () => number): T[]

// db/season.ts — NewSeasonDiscipline gana (todos opcionales, a lo sumo uno de los tres primeros):
  /** "Al azar": el servidor sortea el orden inicial y lo guarda (spec §4). Con `teams`, sortea parejas. */
  shuffle?: boolean
  /** "Igual que": índice en `disciplines` de la disciplina cuyo orden final se copia. Esa no puede ser a su vez `sameOrderAs`. */
  sameOrderAs?: number
  /** Parejas fijas desde el wizard: índices sobre `squadNames`. Exige `fixedTeams: true` y `pairSize: 2`. */
  teams?: Array<[number, number]>

/** Pura y exportada para el test: el orden final de cada disciplina, o `undefined` = el global de siempre. */
export function resolveSeedOrders(
  specs: readonly NewSeasonDiscipline[], squadLength: number, random: () => number,
): Array<number[] | undefined>
```

`resolveSeedOrders`: `seedOrder` → tal cual; `shuffle` → unidades = cada pareja `[a, b]` + cada
suelto `[i]`, `shuffled(unidades, random).flat()`; nada → `undefined`; `sameOrderAs: k` (segunda
pasada) → `resultado[k] ?? [0..n)`.

Validación (en el loop de `:382`, antes de escribir; mensajes exactos):
- dos o más de `seedOrder`/`shuffle`/`sameOrderAs` → `'Cada deporte arma su primera fecha de una sola forma.'`
- `sameOrderAs` no entero, fuera de rango, igual a su índice, o apuntando a otra con `sameOrderAs` → `'"Igual que" tiene que apuntar a otro deporte del torneo.'`
- `teams` sin `fixedTeams` o con `pairSize !== 2` → `'Las parejas fijas sólo van en un deporte de parejas fijas.'`
- un índice de `teams` no entero o fuera de `[0, n)`, una pareja de la misma persona, o alguien en dos parejas → `'Las parejas tienen que ser de dos personas distintas del plantel, cada una en una sola pareja.'`

Escritura: los `seatRows` (`:591`) usan `resolveSeedOrders(…, Math.random)` en vez de `spec.seedOrder`
(el mismo camino de índices de hoy). Después de `discipline_entries`, un solo insert en
`discipline_teams` con todas las parejas (`{ discipline_id, season_id, entry_a, entry_b }` desde
`entryRows`), con el mismo rollback (`delete` de la temporada) si falla. `season_seed_order`
(`:557`) sigue siendo el orden del plantel: es el global, no el de un deporte.
`ponytail:` el orden de `teamsOf` (`created_at, id`) entre parejas del mismo insert es el de los
uuid, y es el orden en que `buildPairs` pone las parejas fijas (`core/pairing.ts:204`) — ya pasaba
con las de Ajustes; si importa para sembrar grupos: ordenar los equipos por `seed_position`.

- [ ] **Step 1: tests que fallan:**
  - `core/order.test.ts`: `shuffled([1,2,3,4], () => 0)` es permutación y no muta la entrada; con un `random` de secuencia fija da un orden fijo.
  - `db/season.unit.test.ts`: `resolveSeedOrders` — `shuffle` con `teams [[0,3],[1,2]]` y 5 asientos → los dos de cada pareja contiguos y el 4 suelto en algún lugar; `sameOrderAs` copia el resuelto (incluido un `shuffle`); sin nada → `undefined`.
  - `db/torneos-deportes.db.test.ts` (+, `admin.client`):
    1. Pádel FIJAS `teams [[0,1],[2,3]]` + `shuffle` → `teamsOf` da las dos parejas; `squadSeedOrder` es permutación del plantel con cada pareja contigua; `season_seed_order` en el orden de `squadNames`.
    2. Pádel `seedOrder [3,2,1,0]` + FIFA individual `sameOrderAs: 0` → los dos `squadSeedOrder` iguales. (FIFA y no ping pong: ping pong recién es deporte de torneo en la Tarea 19.)
    3. **Review Focus 1**: cada mensaje de validación de arriba, y para cada uno `seasons` sin fila nueva del usuario.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: commit** — `feat(torneo): al crear, el sorteo se guarda como orden y las parejas fijas nacen armadas`

---

### Task 12: El wizard nuevo (4 pasos) reemplaza al viejo

**Files:** Create `app/torneos/nuevo/crear.tsx`, `crear.unit.test.ts`; Modify `app/torneos/nuevo/page.tsx:28` (`<Crear myName=… />`), `app/torneos/nuevo/actions.ts:22-33` (input con el `NewSeasonDiscipline` de la Tarea 11, sin cambio de lógica)
**Est.:** ~380 líneas. `wizard.tsx` queda sin montar (lo importa todavía Ajustes) hasta la Tarea 16.

**Interfaces — Consumes:** todo `crear-state.ts` (T10), `TarjetaDeporte` (T9), `PersonalizarReglas` (T8), `reglamento` (T6), `createTournament`. **Produces:**

```typescript
export function Crear({ myName }: { myName: string }): JSX.Element
// exportados para la suite (sin clicks no se llega a cada paso):
export function PasoNuevo(props: { name: string; picked: readonly TournamentSport[]; warning: string | null; onName: (v: string) => void; onToggle: (k: TournamentSport) => void }): JSX.Element
export function PasoComoSeJuega(props: { cards: readonly DeporteElegido[]; squadSize: number; error: string | null; onModality; onPrimeraFecha; onPersonalizar: (k: TournamentSport) => void }): JSX.Element
export function PasoListo(props: { cards: readonly DeporteElegido[]; created: { inviteUrl: string } | null }): JSX.Element
```

Pasos (mockup): barra de 4 segmentos (`bg-accent`/`bg-line`), rótulo `PASO N DE 4`, título 30px.
1. **Nuevo torneo:** nombre (input de hoy, `wizard.tsx:1083-1088`) y "¿QUÉ DEPORTES?" = chips grandes
   estilo `/rapido` (`grid grid-cols-3 gap-2`, `aria-pressed`) de `TOURNAMENT_SPORTS` con
   `sportLabel`; ayuda "Podés elegir más de uno. Cada deporte tiene su tabla, y además hay una
   tabla general."; nada marcado de entrada.
2. **Jugadores:** el plantel de hoy (`wizard.tsx:1099-1191`, mismos handlers puros), piso
   `effectiveFloor` de las modalidades actuales; cualquier cambio del plantel pasa por `plantelCambio`.
3. **Cómo se juega:** una `TarjetaDeporte` por deporte elegido; `errorDeModalidades` como aviso;
   "Personalizar reglas ›" abre `PersonalizarReglas` con la tarjeta (Listo = `cambiarReglas` y
   cierra; `ficha` = `reglasDeFicha`).
4. **Listo, así se juega:** una tarjeta por deporte con su título y cada línea de `reglamento` con
   `✓` (`text-up`); "Crear torneo" (primario, `pending` → "Creando…"); creado: "Ir al torneo"
   (primario) y debajo "Copiar link de invitación" (link, `navigator.clipboard`, "Copiado ✓").

Subpasos todavía no (Tarea 13): `NIVEL` sin ordenar manda el orden del plantel (`order` vacío) y
FIJAS sin `pairs` crea la disciplina sin equipos (se arman en Ajustes → Equipos, como hoy).
Botón "← Volver" como hoy. "Continuar" bloqueado: paso 1 sin nombre o sin deporte; paso 2 con
`squadWarning`; paso 3 con `errorDeModalidades` o `rulesErrors` de alguna tarjeta.

- [ ] **Step 1: tests que fallan** (`crear.unit.test.ts`): `PasoNuevo` → un chip por `TOURNAMENT_SPORTS` (comparar contra la constante, no contra un literal: cambia en la Tarea 19), ninguno `aria-pressed="true"`; `PasoComoSeJuega` con Pádel + FIFA (ping pong recién en la Tarea 19) → dos tarjetas, `Igual que Pádel` en la segunda; `PasoListo` → las líneas de `reglamento` de cada tarjeta, `Crear torneo`; con `created` → `Ir al torneo` y `Copiar link de invitación`.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador** (390px, claro y oscuro): crear "Los Jueves" Pádel (rotan, por nivel) + FIFA (individual, al azar) con 6 jugadores; abrir y cerrar "Personalizar reglas" de los dos (cambiar a 2 sets en Pádel → "Así queda" y la ficha de la tarjeta lo dicen); crear; en `psql`: dos `disciplines` con `formato_default {"kind":"AUTO"}`, `config->>'firstFecha'` `NIVEL`/`SORTEO`, `has_masters` `t`/`f`, `pair_size` 2/1; FIFA con `seed_position` que no es el orden del plantel (puede coincidir por azar: repetir si coincide). Capturas de los 4 pasos y la hoja.
- [ ] **Tests existentes que cambian a propósito:** ninguno (el viejo sigue con sus tests hasta la Tarea 16).
- [ ] **Step 6: commit** — `feat(torneo): el wizard de 4 pasos arma cada deporte desde su ficha`

---

### Task 13: Subpasos "Armá las parejas" y "Ordená por nivel"

**Files:** Create `app/torneos/nuevo/subpasos.tsx`, `subpasos.unit.test.ts`; Modify `crear.tsx`, `crear-state.ts` (+ `moverEnOrden`)
**Est.:** ~360 líneas.

**Interfaces — Consumes:** `tocarJugador`, `agruparChips` (`app/rapido/armar-state.ts:37,77`, sin tocarlo), `sortearParejas`, `parejasCompletas`, `subpasos` (T10). **Produces:**

```typescript
// crear-state.ts
export function moverEnOrden(order: readonly number[], from: number, to: number): number[]   // mueve (no swapea), para el arrastre y para ↑/↓
export function ordenInicial(card: DeporteElegido, seats: number): number[]                  // `order` o, vacío, 0..n-1 (personas o parejas)
// subpasos.tsx
export function ArmarParejas(props: { card: DeporteElegido; names: readonly string[]; pendiente: number | null; onTocar: (i: number) => void; onSortear: () => void }): JSX.Element
export function OrdenarPorNivel(props: { card: DeporteElegido; names: readonly string[]; onMover: (from: number, to: number) => void }): JSX.Element
```

- **Armá las parejas** (mockup 3c): rótulo `PASO 3 DE 4 · SÓLO SI ELEGISTE "PAREJAS FIJAS"`,
  subtítulo `<deporte> · Juegan juntas todo el torneo. La tabla de <deporte> va a ser por pareja.`;
  filas "Fede & Martina" con pastilla `pareja N`, sueltos como chips de `/rapido` (tocar dos
  empareja, tocar una pareja la deshace: `tocarJugador`); "Sortear parejas" (link) llena todo con
  `sortearParejas(n, Math.random)`. "Continuar" sólo con `parejasCompletas`; si no: `Faltan
  emparejar N.` Una sección por deporte FIJAS.
- **Ordená por nivel** (mockup 3b): `<deporte> · Arriba el que mejor juega. Sólo arma ${las parejas
  de | } la primera fecha: después manda la tabla.`; filas con número, iniciales, nombre (o
  "A & B" con FIJAS), asa `⋮⋮` para **arrastrar** (pointer events: `setPointerCapture`, la fila
  destino sale de `clientY` sobre las alturas medidas, `moverEnOrden` al soltar; `touch-action:
  none` sólo en el asa) **y** botones ↑/↓ de 44px (WCAG 2.5.7: alternativa sin arrastre, y la
  única vía con teclado). Una sección por deporte NIVEL. Abajo: "Continuar" y "Mejor que lo sortee
  la app" (link) que pasa esas tarjetas a `SORTEO` y sigue.
- `crear.tsx`: entre el paso 3 y "Listo" corren `subpasos(cards)` en orden; "← Volver" desanda.

- [ ] **Step 1: tests que fallan:** `moverEnOrden([0,1,2,3], 3, 0)` → `[3,0,1,2]`; `ordenInicial` FIJAS con 2 parejas → `[0,1]`; `ArmarParejas` con pairs `[[0,1]]` y 4 nombres → `Fede & Martina` + `pareja 1` + dos chips sueltos + `Faltan emparejar 2.`; `OrdenarPorNivel` con `order [2,0,1]` → filas en ese orden, `↑` del primero `disabled`, `aria-label="Subir a <nombre>"`; FIJAS → filas "A & B".
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador** (390px, claro/oscuro): Pádel FIJAS + FIFA individual por nivel con 6: armar dos parejas a mano y sortear la tercera; arrastrar a alguien del 5° al 1° con el mouse y con touch emulado (`hasTouch: true`, `page.touchscreen`), y con ↑; volver a Jugadores, sacar a uno y volver: parejas y orden vacíos. Crear; `psql`: `discipline_teams` = las parejas elegidas, `seed_position` de FIFA = el orden armado. Capturas.
- [ ] **Step 6: commit** — `feat(torneo): armar las parejas y ordenar por nivel al crear`

---

### Task 14: Ajustes: la hoja reemplaza "Formato" y "Formato de las fechas"

**Files:** Create `app/torneo/[id]/ajustes/reglas-deporte.tsx`, `reglas-deporte.unit.test.ts`; Modify `ajustes/actions.ts` (+ `saveDisciplineRules`), `ajustes/page.tsx:144-151,203-206,266-295`, `[disciplina]/ajustes/page.tsx:184-207`; Delete `ajustes/formato.tsx`, `formato.unit.test.ts`, `formato-default.tsx`, `formato-default.unit.test.ts`
**Est.:** ~330 líneas nuevas/cambiadas (+ ~470 borradas).

**Interfaces — Consumes:** `PersonalizarReglas` (T8), `reglamento` (T6), `fichaSeed`, `modalityOf`, `modalityLabel`, `isSportId` (T1), `disciplineConfig` (`fixedTeams`), `updateDisciplineConfig`/`HasMasters`/`FormatoDefault` (sin cambios). **Produces:**

```typescript
// ajustes/actions.ts
export async function saveDisciplineRules(seasonId: string, disciplineId: DisciplineId, before: DisciplineRules, next: DisciplineRules): Promise<WriteResult>
//   escribe sólo lo que cambió, en este orden: config → has_masters → formato_default.
//   ponytail: tres updates, no una transacción; si falla el segundo, el primero quedó. Si molesta: una RPC.
// reglas-deporte.tsx ('use client')
export function ReglasDeporte(props: {
  seasonId: string; disciplineId: DisciplineId; kind: string; pairSize: SideSize; fixedTeams: boolean
  allowsDraw: boolean; rules: DisciplineRules
}): JSX.Element
```

`ReglasDeporte` (`data-reglas-deporte={disciplineId}`, `id="formato"` lo pone el contenedor como
hoy): tarjeta con `Reglas de <deporte>`, la modalidad como texto (`<Parejas que rotan> · se elige
al crear el torneo`), el reglamento (líneas con `✓`), "Personalizar reglas" (botón secundario).
La hoja abre con `rules` (lo GUARDADO, nunca la ficha); `ficha` = `rulesFromSeed(fichaSeed(kind,
config.squadSize, modalidad))` si `isSportId(kind)` y la ficha ofrece esa modalidad, si no `null`;
`note` = `'Los cambios valen desde la próxima fecha. Las fechas ya jugadas quedan como se jugaron.'`
(verdadero por el congelado de la Tarea 4); "Listo" → `saveDisciplineRules`; error en la hoja,
éxito la cierra. Sin cambios → "Listo" sólo cierra (no escribe). La fila "Formato" de la lista
del torneo (`ajustes/page.tsx:209-214`) sigue, con `formatsLabel` + unidad.
"Texto de reglas" (`Reglas`, `rules_text`) se queda donde está, rotulado `Reglas de la casa`.

- [ ] **Step 1: tests que fallan** (`reglas-deporte.unit.test.ts`): una disciplina existente (Pádel `defaultConfig(8)`, `ROUND_ROBIN`) → `Parejas que rotan · se elige al crear el torneo`, `Cada fecha, todos contra todos.`, sin la frase de primera fecha (**Review Focus 3**); FIFA individual → `Individual · se elige al crear el torneo`, sin Masters. `saveDisciplineRules` se prueba por su efecto en la base (`db/torneos-deportes.db.test.ts`): `before === next` → ninguna escritura (`updated_at`/valores intactos); cambiar `hasMasters` y `formatoDefault` a `AUTO` → las dos columnas; `countBestOf > regularMatchdays` → error de `assertValidConfig` y nada escrito.
- [ ] **Step 2–4:** FAIL → implementar → gates. `rg -n "ajustes/formato'|formato-default'|steppersFor"` fuera de `wizard*` → nada.
- [ ] **Step 5: navegador:** Ajustes de un torneo de un deporte (contenedor) y de uno de dos (`[disciplina]/ajustes`): personalizar, Listo, recargar, persistió; el aviso al lado de Listo; un torneo del seed abre con su config (no la ficha). Capturas claro/oscuro.
- [ ] **Tests existentes que cambian a propósito:** se borran `ajustes/formato.unit.test.ts` y `ajustes/formato-default.unit.test.ts` (sus componentes se van); `app/cableado-de-formato.unit.test.ts` describe `'Ajustes — la página entera'` (`:262-315`): los asserts del panel de Formato pasan a `data-reglas-deporte` (mismos casos: una disciplina inline, 2+ fuera del contenedor); `[disciplina]/ajustes/page.unit.test.ts`: los asserts sobre `data-formato`/`data-formato-default`/"Partidos por fecha" pasan a `data-reglas-deporte` (listarlos en el cuerpo del commit con `rg -n` antes/después).
- [ ] **Step 6: commit** — `feat(ajustes): las reglas de cada deporte se cambian con la misma hoja que al crear`

---

### Task 15: Ajustes: "Agregar un deporte"

**Files:** Modify `ajustes/disciplinas.tsx:33-131,150-242`, `ajustes/actions.ts:221-235`, `db/discipline.ts:322-335,363-495`, `disciplinas.unit.test.ts`; Test `db/torneos-deportes.db.test.ts` (+)
**Est.:** ~330 líneas.

**Interfaces — Consumes:** `TarjetaDeporte` (T9), `PersonalizarReglas` (T8), `fichaSeed` (T1), `shuffled` (T11). **Produces:**

```typescript
// db/discipline.ts — NewDiscipline gana:
  shuffle?: boolean               // "Al azar": se sortea el orden de quienes juegan
  sameOrderAs?: DisciplineId      // "Igual que": el orden de esa disciplina (`squadSeedOrder`); quien no la juega va al final, en el orden del torneo
  // validación: a lo sumo uno; `sameOrderAs` tiene que ser de la MISMA temporada → si no 'Igual que tiene que ser otro deporte de este torneo.'
// ajustes/actions.ts
export async function addSportToSeason(seasonId: string, input: {
  kind: TournamentSport; modality: Modality; primeraFecha: PrimeraFecha; rules: DisciplineRules; entryIds: string[]
}): Promise<WriteResult>   // reemplaza a addDisciplineToSeason; arma la NewDiscipline con fichaSeed(kind, entryIds.length, modality) + rules
```

Pantalla: "+ Agregar un deporte" abre una tarjeta de alta: chips de `TOURNAMENT_SPORTS`, luego la
**misma** `TarjetaDeporte` (primera fecha: `Por nivel` = sub "el orden del torneo"; `Al azar`;
`Igual que <cada disciplina existente>`), "Personalizar reglas ›" con la hoja, "Quién juega" (lo de
hoy, `disciplinas.tsx:83-102`) y "Agregar"/"Cancelar". Sale `NuevaDisciplina` con su
`SelectorDeLados` (la última importación de `wizard.tsx` desde fuera del wizard, salvo `Stepper`
que ya se mudó).

- [ ] **Step 1: tests que fallan:** `db`: `addDiscipline` con `shuffle` → permutación de los que juegan; con `sameOrderAs` → mismo orden que esa disciplina (con un subconjunto: los que no la juegan al final); `sameOrderAs` de otra temporada → error y la disciplina no queda creada. `disciplinas.unit.test.ts` (reescrito el describe `NuevaDisciplina`): la tarjeta de alta muestra los chips, `Igual que Pádel` cuando el torneo ya tiene Pádel, y `Quién juega (N)`.
- [ ] **Step 2–4:** FAIL → implementar → gates. `rg -n "from '@/app/torneos/nuevo/wizard'"` → nada.
- [ ] **Step 5: navegador:** a un torneo de Pádel sumarle FIFA individual "Al azar" con 5 de 6; tabla y fecha de FIFA andan; `psql` del orden. Capturas.
- [ ] **Tests existentes que cambian a propósito:** `ajustes/disciplinas.unit.test.ts` (el formulario cambia entero).
- [ ] **Step 6: commit** — `feat(ajustes): agregar un deporte con la misma tarjeta que al crear el torneo`

---

### Task 16: Se va el wizard viejo

**Files:** Delete `app/torneos/nuevo/wizard.tsx`, `wizard.unit.test.ts`; Modify `wizard-state.ts` (borrar lo que quedó sin importador; congelar `DISCIPLINE_KINDS`), `wizard-state.unit.test.ts` (los describes de lo borrado), `app/cableado-de-formato.unit.test.ts` (describes del wizard)
**Est.:** ~+30 / −2 500 líneas.

- `DISCIPLINE_KINDS = ['PADEL', 'FIFA'] as const` **literal** (ya no `TOURNAMENT_SPORTS`), con un
  JSDoc que diga que es el payload del wizard anterior y que lo usan tests de base como
  constructor de `createSeason` (`db/season-multi-discipline.db.test.ts:2`,
  `db/public-formats.db.test.ts:4`, `db/open-score-screens.db.test.ts:12`). Sin esto, la Tarea 19
  rompe esos tests por tipo (`Record<DisciplineKind, …>` pediría `PING_PONG`).
- Se borra de `wizard-state.ts` (con su describe) cada export cuyo único importador era
  `wizard.tsx`, verificado con `rg -n "<nombre>" -g '!app/torneos/nuevo/wizard-state*'`. Lista
  esperada: `steppersFor`, `STEPPERS`, `Stepper` (interface), `toggleDiscipline`,
  `disciplinesWarning`, `toggleOwnOrder`, `removeFromOrder(s)`, `addToOrder(s)`, `swapInOrder(s)`,
  `moveInOrder`, `visibleOrderPositions`, `filledSeatIndices` (si `seedOrderFrom` no la usa),
  `editSeatState`, `joinSquadState`, `removeSeatState`, `moveGlobalSeatState`, `SquadOrders`,
  `moveSeat`, `resizeConfigs`, `freshDisciplineConfig`, `automaticHasMasters`,
  `FORMATO_DEFAULT_OPTIONS`, `formatoDefaultKey`, `isSameFormatoDefault`, `summaryOf`,
  `newDisciplineSpec`. **Se quedan** (los usa el wizard nuevo o un test de base):
  `DISCIPLINE_KINDS`, `DisciplineKind`, `DISCIPLINE_LABELS`, `buildDisciplines`,
  `newTournamentPayload` (+ `NewTournamentPayloadInput`), `seedOrderFrom`, `submitSeats`,
  `effectiveHasMasters`, `effectiveFixedTeams`, `configFor`, `resizeConfig`, `Squad`,
  `namesAfterEdit`, `removeSeatAt`, `addMySeat`, `addBlankSeat`, `withoutTrailingBlanks`,
  `filledCount`, `effectiveFloor`, `squadWarning`, `formatErrors`. Si `rg` contradice la lista,
  manda `rg`.

- [ ] **Step 1:** no hay comportamiento nuevo: el "rojo" es `npm run typecheck` después de borrar `wizard.tsx` (tiene que dar verde sin tocar otro archivo que los listados; si algo de afuera lo importa, la Tarea 14/15 quedó incompleta).
- [ ] **Step 2:** borrar, congelar, borrar describes. `npm test` y `npm run test:db` completos en verde (los tres tests de base de arriba sin tocar).
- [ ] **Step 3:** gates.
- [ ] **Tests existentes que cambian a propósito:** se borran `app/torneos/nuevo/wizard.unit.test.ts` entero, los describes de `wizard-state.unit.test.ts` de las funciones borradas, y de `app/cableado-de-formato.unit.test.ts` los describes `'el paso 4 del wizard…'` (`:342-420`), `'el paso "Orden inicial"…'` (`:428-460`), `'TITLES/HELP/blocked/advance…'` (`:465-545`), `'los handlers de squad+orders…'` (`:576-625`), `'el submit del wizard…'` (`:644-680`).
- [ ] **Step 4: commit** — `refactor(torneo): se va el wizard de 5 pasos`

---

### Task 17: El armado: "Automático" y "Esta fecha se juega a"

**Files:** Modify `fechas/[n]/armado.tsx:402-416,700-865` (selector) y su cabecera, `fechas/[n]/page.tsx:335-353` (props) y la cabecera de una fecha no-DRAFT, `fechas/page.tsx:174,221` (filas), `fechas/[n]/armado-state.ts` (+ `formatoNotice`)
**Est.:** ~340 líneas.

**Interfaces — Consumes:** `resolveFormato`, `setMatchdayFormat` (AUTO), `changeMatchFormat` (T4), `BloquePartido` (T8), `formatLabel`, `unitOf` (T5). **Produces:**

```typescript
// armado-state.ts
/** "Fecha 3 · 1 set a 6 games", o null si la fecha se juega igual que el deporte hoy. */
export function formatoNotice(number: number, effective: MatchFormat, discipline: MatchFormat, unit: string): string | null
// armado.tsx
SelectorDeFormato props: formato: MatchdayFormatSetting; resolved: MatchdayFormat; headcount: number  // reemplaza `suggested`
export function EstaFechaSeJuegaA(props: { kind: string; effective: MatchFormat; own: MatchFormatOwn | null; unit: string; pending: boolean; onSave: (own: MatchFormatOwn | null) => void }): JSX.Element
```

- **Selector:** arriba, a lo ancho, el botón "Automático" con la segunda línea `→ ${label(resolved)} (vienen ${headcount})` (`aria-checked` cuando `formato.kind === 'AUTO'`); debajo la fila de hoy (Todos contra todos / N grupos + llave). Sale la leyenda `Sugerido: …` (es lo que ahora dice Automático, spec §7). Elegir Automático manda `{ kind: 'AUTO' }`.
- **"Esta fecha se juega a: 1 set a 4 games · Cambiar"** (sólo deportes de sets y sin `openScore`): "Cambiar" despliega `BloquePartido` con el efectivo, "Guardar" → `changeMatchFormat(own)` y "Como el torneo" → `null`. Sólo en DRAFT.
- **Aviso fuera del armado:** la cabecera de la fecha y su fila en la lista (`fechas/page.tsx`) suman `formatoNotice(…)` cuando no es `null`.

- [ ] **Step 1: tests que fallan:** `armado.unit.test.ts` — `SelectorDeFormato` con `formato AUTO`, `resolved` 2 grupos, `headcount 8` → `Automático`, `→ 2 grupos + llave (vienen 8)` y ese botón `aria-checked="true"`; con `ROUND_ROBIN` guardado, Automático `aria-checked="false"`; `EstaFechaSeJuegaA` → `Esta fecha se juega a: 1 set a 4 games`, `Cambiar`; FIFA → no se dibuja. `armado-state.unit.test.ts` — `formatoNotice(3, {1,6}, {1,4}, 'games') === 'Fecha 3 · 1 set a 6 games'`; iguales → `null`.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador:** fecha de Pádel en armado: Automático marcado (torneo nuevo), cambiar a todos contra todos y volver; "Cambiar" a 6 games, armar, confirmar, cargar `6-4` y cerrar; la fecha cerrada y la lista dicen `Fecha 1 · 1 set a 6 games`; `psql`: `formato` concreto y `match_format {"setsToWin":1,"gamesPerSet":6}`. Capturas.
- [ ] **Tests existentes que cambian a propósito:** `armado.unit.test.ts:150-197` — los asserts de `'Sugerido: …'` pasan a la línea de Automático (`'→ 2 grupos + llave'`, `'→ Todos contra todos'`), mismos casos (incluido el que calla cuando la sugerencia no es una opción visible).
- [ ] **Step 6: commit** — `feat(fecha): el armado muestra "Automático" y a cuánto se juega cada fecha`

---

### Task 18: En parejas fijas, la tabla del deporte va por pareja

**Files:** Modify `app/torneo/[id]/tabla-state.ts` (+ `pairRows`), `tabla-view.tsx`, `[disciplina]/page.tsx`; Test `tabla-state.unit.test.ts` (+)
**Est.:** ~200 líneas. La tabla general (`app/torneo/[id]/page.tsx`) no cambia (§8).

**Interfaces — Consumes:** `teamsOf` (`db/discipline-teams.ts:20`), `disciplineConfig`, `mastersCutoffFor` (T5). **Produces:**

```typescript
/** Una fila por pareja fija (nombre "A & B", puntos y movimiento del mejor ubicado de los dos), los sueltos como están, puestos 1..n de nuevo. */
export function pairRows(rows: readonly StandingsRow[], teams: readonly { a: string; b: string }[]): { rows: StandingsRow[]; mastersAfter: number }
//   mastersAfter = cuántas filas cubren a los MASTERS_SIZE primeros jugadores (pareja = 2)
// TablaView gana `teams: readonly { a: EntryId; b: EntryId }[]` (requerido; `[]` sin parejas fijas)
```

`[disciplina]/page.tsx`: `const { fixedTeams } = await disciplineConfig(…)`; `teams = fixedTeams ? (await teamsOf(…)).map(t => ({ a: t.entryA, b: t.entryB })) : []`. En `TablaView`, con `teams.length > 0`, `rows` y el corte salen de `pairRows`; el desempate (hoja `Desempate`) sigue por persona.
`ponytail:` si los dos de una pareja tuvieran puntos distintos (una fecha jugada antes de armar la pareja), la fila muestra los del mejor ubicado.

- [ ] **Step 1: tests que fallan:** 6 filas, equipos `[e1,e4]`, `[e2,e3]`, `e5`,`e6` sueltos → 4 filas: `Ana & Dani` (puesto del mejor), …, puestos 1..4; `mastersAfter === 2` con las parejas arriba; sin equipos → filas idénticas a la entrada.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador:** el torneo FIJAS de la Tarea 13, cerrar una fecha: la tabla de Pádel muestra "Fede & Martina · N pts", la general sigue por persona. Capturas claro/oscuro.
- [ ] **Step 6: commit** — `feat(tabla): con parejas fijas, una fila por pareja`

---

### Task 19: Ping pong en torneos (ventaja en la carga) + verificación completa

**Files:** Modify `fechas/[n]/carga.tsx:27-34,231-252,302-318`, `fechas/[n]/page.tsx:652,940` (`unit` en el contexto), `core/sports.ts:47-51,78`; Test `carga.unit.test.ts` (+), `core/sports.test.ts` (+), `db/torneos-deportes.db.test.ts` (+)
**Est.:** ~150 líneas + la verificación.

**Interfaces — Consumes:** `deuceOptions`, `chooseDeuce` (`app/amigos/[playerId]/cargar-state.ts:126,133`, sin tocarlo), `isComplete`/`chooseLoserGames` (`carga-state.ts`, sin tocarlo). **Produces:**

```typescript
CargaContext.unit: string                     // `unitOf(kind, format)`
export function BotonesDelPerdedor(props: { format: MatchFormat; unit: string; pending: boolean; onLoser: (n: number) => void; onDeuce: (loser: number) => void }): JSX.Element   // exportado para la suite
SPORTS.PING_PONG.tournaments = true
TOURNAMENT_SPORTS = ['PADEL', 'PING_PONG', 'FIFA'] as const   // orden del registro = orden de los chips
```

Carga: el prompt pasa a `` `${cap(unit)} del perdedor` `` ("Games del perdedor" en pádel, igual
que hoy); después de `loserGamesOptions(format)` van `deuceOptions(format)` como botones
`${loser + 2}-${loser}` (`aria-label` `` `${loser + 2} a ${loser}` ``). `tapGames` se parte en
`completar(next)` (lo de hoy desde `:233`) y dos llamadores:
`completar(chooseLoserGames(state, n, format))` y `completar(chooseDeuce(state, loser, format))`.
Pádel (`tieBreak: true`) no dibuja ninguno nuevo (`deuceOptions` → `[]`).

- [ ] **Step 1: tests que fallan:** `carga.unit.test.ts` (it nuevo) — `BotonesDelPerdedor` con el formato de ping pong → `Puntos del perdedor`, `0`…`9` y `12-10`…`16-14`; con pádel → `Games del perdedor`, `0`…`3`, sin `-`. `core/sports.test.ts` — `isTournamentSport('PING_PONG') === true` (el test 3 existente ya ata la tupla al flag). `db`: `createSeason` con Ping pong individual (`fichaSeed`) y una fecha: `saveResult([12-10, 11-5])` ok; `[11-10]` rechazado.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: verificación completa (spec §11), 390px, claro y oscuro, base local:**
  1. Crear "Pádel + Ping pong" (Pádel rotan por nivel con orden arrastrado; Ping pong individual al azar) con 6 jugadores; personalizar Pádel a 2 sets.
  2. Crear "FIFA individual" con 8.
  3. Crear un Pádel parejas fijas (armar parejas + sortear) para la tabla por pareja.
  4. Jugar una fecha de cada uno: Pádel con formato propio (a 6 games); Ping pong con un `12-10` cargado con los botones de ventaja; FIFA con Automático → 2 grupos + llave, avanzar la llave y cerrar.
  5. Tablas (incluida la de parejas fijas y la general), Reglas con y sin sesión, Ajustes de cada deporte (hoja + aviso), `/rapido` intacto (crear uno y cargar un partido).
  6. Cruzar en `psql` cada cosa que una pantalla afirma (formatos, `match_format`, órdenes, equipos, `kind 'PING_PONG'`, URL `/ping-pong/`, el 308 de `/fechas/1`).
  7. Capturas para el dueño, una por pantalla y tema, listadas en el informe.
- [ ] **Step 6: commit** — `feat(torneo): ping pong en torneos, con los botones de ventaja en la carga`

---

## Tests existentes que cambian a propósito (resumen para el revisor)

| tarea | archivo | qué y por qué |
|---|---|---|
| 4 | `app/torneos/page.unit.test.ts`, `fechas/[n]/page.unit.test.ts` | fixture de tipo: `matchFormat: null` en los `MatchdaySummary` |
| 5 | `core/narrate.test.ts:362` | copy: `'3 sets a 4 games'` → `'mejor de 5 sets a 4 games'` |
| 5 | `core/narrate.test.ts`, `campeon-de-la-fecha.unit.test.ts`, `tabla-desempate.unit.test.ts` | firma (`unit`), mismo texto esperado |
| 5 | `stats/page.unit.test.ts` | mock de `@/db/discipline` (`fixedTeams`) |
| 7 | `db/public-formats.db.test.ts:131-150` | seis → ocho columnas públicas |
| 7 | `reglas/rules-body.unit.test.ts`, 2 describes de `cableado-de-formato` | Reglas: reglamento arriba, acordeón en "Más detalle" |
| 7 | `core/narrate.test.ts` | copy (`La fecha` sin "y juegan todos contra todos"), fixture (`fixedTeams` en `DisciplineShape`), firma (`unit`) |
| 14 | `ajustes/formato*.unit.test.ts` (borrados), `cableado` "Ajustes — la página entera", `[disciplina]/ajustes/page.unit.test.ts` | los paneles viejos se van; mismos casos sobre el panel nuevo |
| 15 | `ajustes/disciplinas.unit.test.ts` | el formulario de alta cambia entero |
| 16 | `wizard.unit.test.ts` (borrado), describes de `wizard-state.unit.test.ts` y `cableado` | el wizard viejo se va |
| 17 | `armado.unit.test.ts:150-197` | "Sugerido:" pasa a ser el botón Automático |

## Riesgos

1. **Desempate por diferencia de sets con fechas a distinto formato** (§7): mezcla fechas
   distintas. Aceptado; `ponytail:` en `effectiveMatchFormat`.
2. **`AUTO` que se escapa de DRAFT:** lo frena la base (`matchdays_formato_auto_draft`) y
   `openMatchday` lo resuelve antes; test de base en las Tareas 2 y 4.
3. **Guardado de la hoja no atómico** (tres updates): un error a mitad deja parte escrita y el
   mensaje lo dice; el guard de concurrencia de `updateDisciplineConfig` (`db/discipline.ts:146`)
   sigue igual. `ponytail:` en la action.
4. **Estados intermedios de la rama:** entre las Tareas 12 y 14 el radio viejo de "Formato de las
   fechas" en Ajustes no marca ninguna opción para un torneo nuevo (`AUTO` no está en su lista).
   La rama se mergea entera; no se despliega a mitad.
5. **Mensajes del servidor con "games" en ping pong:** `setError` (`db/validate.ts:47-89`) dice
   "set a 11 games" si alguien fuerza un resultado ilegal por fuera de los botones (que sólo
   producen resultados legales). Fuera de alcance: lo comparten amigos y `/rapido`.
6. **Orden de las parejas fijas al sembrar grupos:** `buildPairs` pone las parejas fijas en el
   orden de `teamsOf` (creación), no en el de `seed_position` — ya era así. `ponytail:` en la
   Tarea 11.
7. **El detalle de Reglas puede volver a contradecir al reglamento** si alguien cambia una de las
   dos narraciones sin la otra. Red: los tests de la Tarea 7 piden que "Más detalle" no diga
   "todos contra todos" ni hable de parejas que rotan en parejas fijas, y que use la unidad del
   deporte.

## Lo que este plan NO hace

- Navegación dentro del torneo (inicio "padel ›", tabla de FIFA sin decir "FIFA", íconos, volver
  en Stats/Reglas): diseño aparte.
- Deportes de equipo (fútbol, básquet) en torneos: lados de más de 2.
- Tenis (7-6) y vóley (set decisivo a 15).
- Torneo rápido (`/rapido`) sobre el registro, y el puente rápido → fecha de torneo.
- Re-sortear el orden o las parejas después de crear; ordenar por nivel desde Ajustes.
- Cambiar la modalidad (`pair_size`/`fixed_teams`) después de crear.
- Que la base valide formas o rangos por deporte (sigue la opción B de `0093`).

## Respuestas del dueño (2026-10-14, vinculantes)

1. **Reglas:** el reglamento en criollo va arriba y el acordeón detallado de hoy se queda debajo,
   cerrado, bajo "Más detalle" (Tarea 7).
2. **Automático:** `suggestFormat` tal cual: con 6 jugadores de a uno, 2 grupos + llave (10
   partidos); para todos contra todos se elige al armar esa fecha. Agregado a
   `docs/torneos-deportes.md` §7; el texto del mockup de ping pong queda superado.

## Ejecución

Subagent-driven: un subagente nuevo por tarea (TDD estricto, gates, navegador donde dice), un
revisor nuevo por tarea (spec + esta tarea + `git diff` contra la lista de tests que cambian) y una
revisión final de toda la rama antes de cualquier PR. Las tareas son secuenciales: cada una consume
nombres exactos de las anteriores (bloques **Interfaces**).
