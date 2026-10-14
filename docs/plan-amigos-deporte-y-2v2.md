# Amigos — deporte tipado y partido casual 1v1 / 2v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⚠ Leer antes de ejecutar
>
> **`0072_casual_matches.sql` se REESCRIBE en el lugar.** Nunca llegó a
> producción: `git log main -- supabase/migrations/0072_casual_matches.sql`
> sale vacío (verificado al escribir este plan; producción despliega desde
> `main`). **Volver a correr ese comando antes de la Tarea 2** — si alguna vez
> sale algo, este plan deja de valer y hace falta una `0090` + backfill.
> Ninguna migración posterior (`0073`–`0089`) menciona `casual_` (`rg -l casual
> supabase/migrations` → sólo `0072`).
>
> **Toda base local necesita `npm run db:reset`** después de la Tarea 2. Nada de
> esto toca una base remota.

**Goal:** El partido casual deja de ser "dos personas + deporte en texto libre":
el deporte es `PADEL | FIFA`, el marcador sigue las reglas de cada uno, y puede
ser 1v1 o 2v2 con amigos aceptados o invitados (sólo un nombre).

**Architecture:** `casual_matches` pierde `player_a/player_b/winner` y gana
`winner_side`; los jugadores pasan a `casual_match_players` (lado A/B, cuenta o
invitado). La puerta de amistad aceptada sigue siendo RLS, ahora sobre la tabla
de jugadores. Los sets de pádel van a `casual_match_sets` (espejo de
`match_sets`), con el formato elegido al cargar. Alta y edición son UNA RPC
`security invoker` (atómica, la RLS sigue mandando); borrar sigue siendo un
`delete` directo como hoy.

**Tech Stack:** Next.js 15, React 19, TS 5.7 strict, Supabase (RLS), Tailwind v4, vitest.

## Decisiones tomadas (no se re-discuten)

| tema | decisión | por qué |
|---|---|---|
| deporte | columna `sport text check (sport in ('PADEL','FIFA'))`; en TS el literal `'PADEL' \| 'FIFA'` | mismo literal que `TournamentMatch.sport` (`db/friends.ts:91`). `core/` NO tiene un tipo de kind (sólo `disciplineProfile(kind: 'PADEL' \| 'FIFA')`); `DisciplineKind` vive en `app/torneos/nuevo/wizard-state.ts:107` y `db/` no importa de `app/` (regla ya escrita en `db/friends.ts:74-80`). La pantalla traduce con `DISCIPLINE_LABELS`. |
| invitado | **`guest_name text`**, NO el invitado de torneo | el invitado de torneo es una fila de `entries` (`kind='GUEST'`) con `season_id` y `matchday_id` **not null** (`0001_schema.sql:55-75`): no existe fuera de una fecha de torneo. Crear `players` sin cuenta tampoco sirve: `authenticated` no tiene ningún camino de INSERT a `players` (sólo el trigger de alta `0003_new_user.sql:8`), `players_read` está abierta (§5.5) — cada invitado ensuciaría la tabla global — y "sin vincular después" es justo lo que un `players` sin `user_id` invita a hacer. |
| pádel casual | **el formato se elige al cargar** (decisión del usuario): `setsToWin` y `gamesPerSet` con los mismos steppers y rangos del wizard (`STEPPERS`, `wizard-state.ts:30`), prellenados con `defaultConfig(4).matchFormat` (1 set a 4); `tieBreak` sale del default y NO es perilla (el wizard tampoco la muestra). Sets en `casual_match_sets`, espejo de `match_sets` (`0001_schema.sql:194`). Ganador derivado, sin empate | cero reglas nuevas: se valida con `matchError(sets, formato, false)` de `db/validate.ts`, la misma del torneo. |
| formato guardado | **NO se guarda**: sólo los sets | con `tieBreak` fijo en `true` (no es perilla), el formato se DEDUCE de los sets: `gamesPerSet` = games del ganador de cualquier set (`setError`, `db/validate.ts:76`: el ganador de un set llega exacto a `gamesPerSet`), `setsToWin` = sets del ganador. Editar prellena los steppers con eso (`formatFromSets`, Tarea 4b). `ponytail:` si algún día `tieBreak` pasa a ser perilla, ahí sí hacen falta columnas de formato. |
| FIFA | goles opcionales (los dos o ninguno), empate permitido, `winner_side` propio (penales: §4.3 sigue valiendo), equipo opcional por lado **sólo FIFA** | §4.2/§4.3 del diseño, sin cambios. |
| quién edita | **cualquier participante CON CUENTA** edita el resultado y borra; **el plantel (quién jugó) queda fijo al cargar** — se corrige borrando y cargando de nuevo | el código actual dice "cualquiera de los dos" (§3.1, §3.3, `0072` políticas update/delete) → se mantiene. El plantel no se edita porque la puerta de amistad es relativa a quien carga: si otro pudiera cambiar jugadores, habría que decidir "amigo de quién". YAGNI. |
| alta y edición | RPC `save_casual_match(...)` `security invoker` (crea si `p_id` es null; si no, edita resultado y REEMPLAZA los sets) | varias tablas en una transacción (partido + jugadores + sets; editar = borrar sets + insertar): PostgREST no puede, y el chequeo de forma es diferido al commit. Invoker → la RLS de las tres tablas sigue siendo la puerta. Borrar sigue siendo `delete` directo. |
| forma 1–2 por lado, iguales | constraint trigger `deferrable initially deferred` | invariante entre filas → no entra en un CHECK. Trigger y no TS: mismo argumento que `0045` ("un guard de TypeScript no cubre un PATCH directo"). |

## Global Constraints

- **TDD estricto.** Test que falla primero, visto fallar por el motivo correcto.
- **Gates en cada tarea:** `npm test && npm run test:db && npm run typecheck && npm run build` (Supabase local corriendo).
- Tests de permisos por cliente **autenticado**, jamás `adminClient()` (salvo andamiaje).
- Todo select nuevo lleva `{ count: 'exact' }` + `assertComplete` (PostgREST `max_rows = 1000`).
- Identidad DERIVADA de `my_player_id()`, nunca recibida (`created_by` lo pone la RPC).
- Tabla/función nueva: `grant` a `authenticated`/`service_role` **y** `revoke … from anon` (función: `from public, anon`).
- `core/` no se toca. Sin dependencias nuevas. Commits sin atribución de IA.
- Fuera de alcance: buscador de jugadores (sigue el pegar-ID), cancelar solicitudes enviadas, vincular invitados a cuentas, editar el plantel.

## Estructura de archivos

| archivo | tarea | qué |
|---|---|---|
| `db/friends.ts` | 1, 2 | parser del resultado, escrituras, `historyWith` casual; se borra `sportsUsedBy` |
| `db/friends.unit.test.ts` | 1, 2 | parser + mocks de la lectura casual |
| `supabase/migrations/0072_casual_matches.sql` | 2 | reescrita |
| `db/friends.db.test.ts`, `db/database.types.ts` | 2 | suite casual reescrita, tipos regenerados |
| `app/amigos/actions.ts` | 2, 4a, 4b | `casualInputFrom` |
| `app/amigos/historial.tsx` (+ `.unit.test.ts`) | 3 | fila casual: juntos/en contra, nombres, deporte |
| `app/amigos/[playerId]/cargar-state.ts` (nuevo, + `.unit.test.ts`) | 4a, 4b | estado puro del formulario |
| `app/amigos/[playerId]/cargar.tsx` (+ `.unit.test.ts`) | 4a, 4b, 5 | formulario |
| `app/torneos/nuevo/wizard.tsx` | 4b | `export` de `Stepper` |
| `app/amigos/[playerId]/page.tsx`, `app/amigos/page.tsx` | 2, 4a, 5 | datos + pulido |

---

### Task 1: El resultado casual se valida por deporte

**Files:** Modify `db/friends.ts`, `db/friends.unit.test.ts`
**Est.:** ~190 líneas (85 código, 105 test)

**Interfaces — Produces** (exportado, puro; todavía nadie lo llama — la Tarea 2 lo enchufa):

```typescript
export const CASUAL_PADEL_DEFAULT: MatchFormat // disciplineProfile('PADEL', defaultConfig(4)).config.matchFormat
export interface CasualResultInput {        // texto crudo de FormData, en "mío/suyo"
  sport: string; playedOn: string; outcome: string
  scoreMine: string; scoreTheirs: string; teamMine: string; teamTheirs: string
  setsToWin: string; gamesPerSet: string    // sólo PADEL
  sets: string                              // sólo PADEL: JSON [{mine, theirs}, …]
}
export interface CasualResult {
  sport: 'PADEL' | 'FIFA'; playedOn: string
  outcome: 'won' | 'lost' | 'drew'
  scoreMine: number | null; scoreTheirs: number | null          // FIFA
  teamMine: string | null; teamTheirs: string | null            // FIFA
  format: MatchFormat | null                                    // PADEL, sólo para validar: no se guarda
  sets: Array<{ mine: number; theirs: number }> | null          // PADEL
}
export function parseCasualResult(input: CasualResultInput): CasualResult // EdgeError si no
```

Reglas (reusar `esFechaReal`, `normalizeTeam`, `matchError` — no escribir validadores nuevos):
- `sport` ∉ {PADEL, FIFA} → `'Elegí Pádel o FIFA.'`
- **PADEL:** formato = `{ ...CASUAL_PADEL_DEFAULT, setsToWin, gamesPerSet }`, enteros dentro de los `min`/`max` de `STEPPERS` — los rangos se copian como constantes en `db/` (no se importa de `app/`) con un comentario que apunta a `wizard-state.ts:30`. `sets` parseado (array de pares de enteros) y validado con `matchError(sets→{gamesA: mine, gamesB: theirs}, format, false)` → su mensaje tal cual (cubre "falta un set", "set imposible", "sobra un set"). `outcome` se **deriva** de quién ganó más sets (se ignora lo que venga). Marcador de goles o equipos no vacíos → error (`'Los equipos son sólo para FIFA.'`).
- **FIFA:** marcador opcional (los dos o ninguno, enteros ≥ 0 — `matchError(..., disciplineProfile('FIFA', …).config.matchFormat, true)`); `outcome` obligatorio ∈ won/lost/drew; si el marcador NO está empatado, `outcome` tiene que coincidir (`'El marcador dice otra cosa sobre quién ganó.'`) — con marcador empatado cualquier `outcome` vale (penales, §4.3). `format`/`sets` → `null`.

- [ ] **Step 1: tests que fallan** (`describe('parseCasualResult')`): PADEL 1 set a 4 `[4-2]` → won; PADEL a 2 sets de 6 `[6-3, 4-6, 6-5]` (con tie-break el ganador del set siempre llega a `gamesPerSet`: `loserGamesOptions`) → won; `[6-3]` con `setsToWin: 2` → error (falta set); `[4-4]` → error; `gamesPerSet: 12` → error de rango; PADEL con equipo → error; FIFA `2-2` + won → ok; FIFA `3-1` + lost → error; FIFA sin marcador + drew → ok; sport `'Fifa'` → error.
- [ ] **Step 2:** `npm test -- db/friends.unit.test.ts` → FAIL (no existe).
- [ ] **Step 3:** implementar junto a `parseCasualInput` (que sigue vivo hasta la Tarea 2).
- [ ] **Step 4: gates + commit** — `feat(amigos): el resultado casual se valida según el deporte`

---

### Task 2: El cambio de esquema — lados A/B, invitados, 1v1 o 2v2

La tarea grande y la única que no se puede partir: al regenerar los tipos,
todo lo que lee `player_a`/`player_b`/`winner` de `casual_matches` deja de
compilar. **El inventario de lo que hay que tocar ES la lista de errores de
`tsc`.** La pantalla queda andando en 1v1 con el formulario viejo (pegamento
mínimo en la action); el formulario nuevo son las Tareas 4a y 4b.

**Files:**
- Rewrite: `supabase/migrations/0072_casual_matches.sql`
- Modify: `db/database.types.ts` (regenerado), `db/friends.ts`, `db/friends.db.test.ts`, `db/friends.unit.test.ts`, `app/amigos/actions.ts`, `app/amigos/[playerId]/page.tsx`, `docs/historial-entre-amigos.md` (§4.1 y §7: una línea cada uno apuntando a este plan — §7 decía "no hay casual de a cuatro")

**Est.:** ~820 líneas (migración ~290 con comentarios, db tests ~280, `friends.ts` ~190 neto, pegamento ~60). Es la que justifica un review aparte; no se puede partir (ver arriba).

**Esquema** (conservar el registro de comentarios de la `0072` actual — los párrafos de `safeupdate`, del grant por columna, del trigger de `updated_at` y de la puerta §4.5 se ADAPTAN, no se borran):

```sql
create table public.casual_matches (
  id          uuid primary key default gen_random_uuid(),
  sport       text not null check (sport in ('PADEL', 'FIFA')),
  played_on   date not null,
  winner_side text check (winner_side in ('A', 'B')),   -- null = empate
  score_a     int check (score_a >= 0),             -- goles: sólo FIFA
  score_b     int check (score_b >= 0),
  team_a      text check (team_a is null or length(trim(team_a)) > 0),
  team_b      text check (team_b is null or length(trim(team_b)) > 0),
  created_by  uuid not null references public.players,
  updated_by  uuid not null references public.players,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint casual_score_pair  check ((score_a is null) = (score_b is null)),
  constraint casual_teams_fifa  check (sport = 'FIFA' or (team_a is null and team_b is null)),
  -- pádel: sin goles, sin empate; el resultado vive en casual_match_sets
  constraint casual_padel_shape check (sport <> 'PADEL' or (score_a is null and winner_side is not null))
);

create table public.casual_match_players (
  match_id   uuid not null references public.casual_matches on delete cascade,
  side       text not null check (side in ('A', 'B')),
  player_id  uuid references public.players on delete cascade,
  guest_name text check (guest_name is null or length(trim(guest_name)) > 0),
  constraint casual_player_xor check (num_nonnulls(player_id, guest_name) = 1),
  unique (match_id, player_id)          -- NULLs distintos: varios invitados OK
);
create index casual_match_players_by_player on public.casual_match_players (player_id);

-- Espejo de match_sets (0001_schema.sql:194-204), mismo nombre de columnas.
create table public.casual_match_sets (
  match_id   uuid not null references public.casual_matches on delete cascade,
  set_number int  not null check (set_number >= 1),
  games_a    int  not null check (games_a >= 0),
  games_b    int  not null check (games_b >= 0),
  primary key (match_id, set_number),
  constraint casual_sets_no_draw check (games_a <> games_b)
);
```

**Lo que la base NO chequea, a propósito:** que los sets cierren un partido legal para el formato elegido y que `winner_side` coincida con ellos. El formato no se guarda (decisión arriba) y "legal" es `matchError`, que vive en TS: lo valida `parseCasualResult` en el único camino de escritura (la RPC vía `db/friends.ts`). `ponytail:` un POST directo a la RPC puede guardar sets incoherentes en SU propio partido; si eso importa, un trigger diferido que cuente sets por lado.

(`match_id` ya queda indexado por la `unique`.) `on delete cascade` en `player_id`: si se borra una cuenta, su fila desaparece y el trigger de forma NO corre en ese delete (ver abajo) — el partido queda desparejo; aceptado, mismo destino que hoy (`0072` actual cascadea el partido entero).

**Funciones:**
1. `is_casual_participant(p_match uuid) returns boolean` — `language sql stable security definer set search_path = ''`, mismo molde que `is_participant` (`0002_rls.sql:11`): `exists (… where match_id = p_match and player_id = my_player_id())`. **Definer a propósito**: la política de lectura de `casual_match_players` consulta la propia tabla, y como invoker eso es recursión infinita (`42P17`).
2. `casual_match_shape()` + `constraint trigger … after insert on casual_matches` **y** `after insert on casual_match_players`, `deferrable initially deferred`, `for each row`. Para el `match_id` de la fila (si el partido ya no existe → `return null`): lados A y B con 1 o 2 filas cada uno, misma cantidad, y `created_by` es uno de los `player_id`. Si no → `raise exception … using errcode = '23514'` con un mensaje legible.
3. `save_casual_match(p_id uuid, p_sport text, p_played_on date, p_winner_side text, p_score_a int, p_score_b int, p_team_a text, p_team_b text, p_players jsonb, p_sets jsonb) returns uuid` — `plpgsql security invoker set search_path = ''`. `v_me := public.my_player_id()`.
   - **`p_id` null (alta):** `v_id := gen_random_uuid()`; insert del partido con `created_by = updated_by = v_me`; `insert into casual_match_players select v_id, x.side, x.player_id, x.guest_name from jsonb_to_recordset(p_players) as x(side text, player_id uuid, guest_name text)`; **después** los sets (el orden importa: la RLS de sets pide ser participante). Sin `returning` (ver riesgo 2).
   - **`p_id` no null (edición):** `p_players` se ignora (plantel fijo); `update casual_matches set … , updated_by = v_me where id = p_id` (0 filas → `raise … errcode '42501'`); `delete from casual_match_sets where match_id = p_id`; insert de `p_sets`. Todo en la misma transacción: nunca queda un partido de pádel sin sets a la vista.
   - Sets: `insert into casual_match_sets select v_id, x.set_number, x.games_a, x.games_b from jsonb_to_recordset(p_sets) as x(set_number int, games_a int, games_b int)`.
4. Se conserva tal cual `casual_matches_touch_updated_at`.
- Todas: `revoke execute … from public, anon`; la RPC además `grant execute … to authenticated`.

**Permisos y RLS:**

```sql
grant select, insert, delete on public.casual_matches to authenticated;
grant update (sport, played_on, winner_side, score_a, score_b, team_a, team_b, updated_by)
  on public.casual_matches to authenticated;
grant select, insert on public.casual_match_players to authenticated;   -- sin update/delete: plantel fijo
grant select, insert, delete on public.casual_match_sets to authenticated; -- editar = reemplazar
grant all on public.casual_matches, public.casual_match_players, public.casual_match_sets to service_role;
revoke all on public.casual_matches, public.casual_match_players, public.casual_match_sets from anon;
```

| política | regla |
|---|---|
| `casual_matches_read` | `created_by = my_player_id() or is_casual_participant(id)` |
| `casual_matches_insert` | `created_by = my_player_id() and updated_by = my_player_id()` |
| `casual_matches_update` | using `is_casual_participant(id)` · check `updated_by = my_player_id()` |
| `casual_matches_delete` | using `is_casual_participant(id)` |
| `casual_match_players_read` | `is_casual_participant(match_id)` |
| `casual_match_players_insert` | el partido es MÍO (`exists … m.created_by = my_player_id()`) **y** (`player_id is null` **o** `player_id = my_player_id()` **o** existe amistad ACEPTADA entre `least(me, player_id)` y `greatest(me, player_id)` en `friendships`) |

| `casual_match_sets_read` / `_insert` / `_delete` | `is_casual_participant(match_id)` |

La fila de `casual_match_players_insert` **es la puerta §4.5**, movida de tabla: el párrafo "es un canal de acoso, no una formalidad" va encima de ESTA política. El borrado de jugadores sale del `on delete cascade` del partido (las acciones referenciales no pasan por RLS).

**`db/friends.ts`:**
- `CasualMatch` cambia: `sport: 'PADEL' | 'FIFA'`; **gana `together: boolean`** (mismo lado que el amigo de la pantalla), `partners: string[]` (mi lado, sin mí) y `rivals: string[]` (el otro lado) — nombres de cuenta o `guest_name`. `score` (goles, FIFA) y `teams` siguen como `{ mine, theirs }`, ahora orientados por MI lado; **gana `sets: Array<{ mine: number; theirs: number }> | null`** (PADEL, en orden de `set_number`). Actualizar el JSDoc de `SharedMatch` (hoy dice que `together` sólo existe en torneo).
- `historyWith`, parte casual — reemplaza consultas 6 y 7, todas con `count: 'exact'` + `assertComplete`:
  6. `casual_match_players` `match_id` donde `player_id = friendPlayerId` (la RLS ya lo acota a partidos donde yo juego). Vacío → no hay casuales.
  7. `casual_matches` `.in('id', ids)`.
  8. `casual_match_players` `.in('match_id', ids)` (todos los jugadores).
  9. `players` `display_name` de jugadores con cuenta + autores (el `autores` de hoy, ampliado).
  10. `casual_match_sets` `.in('match_id', idsDePadel)` — sólo si hay alguno.
  `outcome`: `winner_side === null ? 'drew' : winner_side === miLado ? 'won' : 'lost'`; `together = ladoDelAmigo === miLado`.
- `createCasualMatch(supabase, players: CasualPlayerInput[], input: CasualResultInput)` → `rpc('save_casual_match', { p_id: null, … })`, con `CasualPlayerInput = { side: 'mine' | 'theirs'; playerId: string | null; guestName: string | null }`. Usa `parseCasualResult` (Tarea 1); el caller es SIEMPRE lado A (sin orden canónico: ya no hay `player_a < player_b`), así que mine→A sin traducción. Se agrega al caller (`{side:'A', player_id: me}`) acá, no lo manda la pantalla. Errores: `42501` → "tienen que ser amigos aceptados"; `23514` del trigger → su mensaje; `22P02` → "Ese ID no es válido."
- `updateCasualMatch` → misma RPC con `p_id`: lee MI lado de `casual_match_players` (`player_id = me`, `maybeSingle`) — `null` → "no existe o no te corresponde"; orienta mine/theirs (goles, equipos, games de cada set) → A/B con ese lado; devuelve un `friendPlayerId` para el redirect: el primer otro jugador CON cuenta del partido (si no hay, `null` → la action redirige a `/amigos`).
- `deleteCasualMatch`: igual de lectura previa; mismo retorno.
- **Borrar `sportsUsedBy`** y `parseCasualInput` (reemplazado por `parseCasualResult`).

**Pegamento para que la pantalla siga andando en 1v1:** `casualInputFrom` (`actions.ts`) arma `players = [{ side: 'theirs', playerId: friendPlayerId, guestName: null }]` y, si es PADEL, convierte los dos números viejos en UN set (`sets = [{mine, theirs}]`, `setsToWin: '1'`, `gamesPerSet: max(mine, theirs)`); `page.tsx` deja de pedir/pasar `sportsUsedBy`. El input de deporte sigue siendo texto hasta la Tarea 4a (escribir `PADEL`/`FIFA` funciona).

- [ ] **Step 0:** `git log main -- supabase/migrations/0072_casual_matches.sql` → vacío. Si no, PARAR.
- [ ] **Step 1: tests que fallan** (`db/friends.db.test.ts`, la suite casual se reescribe; clientes autenticados):
  1. 1v1 entre amigos aceptados → ok; el amigo lo ve en `historyWith` con `together: false`.
  2. 2v2 (yo + amigo1 vs amigo2 + invitado "Tano") → ok; amigo1 lo ve `together: true`, amigo2 `false`, rivals/partners con "Tano".
  3. **Jugador con cuenta que NO es amigo aceptado → rechazado** (también pendiente).
  4. 2v1 y 3v3 → rechazados por el trigger (23514); 0 filas quedan (atómico).
  5. Un tercero (amigo mío que no jugó) no ve el partido ni sus jugadores.
  6. Un participante no creador puede editar el resultado → `updated_by` = él; NO puede insertar jugadores al partido.
  7. Un participante no creador puede borrarlo; un invitado obviamente no existe como cliente.
  8. PADEL con goles, con equipos o set `3-3` → rechazado por CHECK (RPC directa).
  9. PADEL a 3 sets → `historyWith` lo devuelve con los tres sets en orden, orientados para cada lector.
  10. Editar un PADEL de 3 sets a 2 sets → quedan exactamente 2 filas en `casual_match_sets`; un tercero no ve ninguna.
- [ ] **Step 2:** `npm run test:db -- db/friends.db.test.ts` → FAIL.
- [ ] **Step 3:** reescribir `0072`, `npm run db:reset && npm run db:types`, ajustar `friends.ts`/actions/page hasta que `tsc` calle; `friends.unit.test.ts`: mocks de las consultas 6–10 + un guard de truncado por consulta nueva.
- [ ] **Step 4: romper la puerta a propósito:** sacar la rama de amistad de `casual_match_players_insert`, `db:reset` → **el test 3 FALLA**. Restaurar, `db:reset`.
- [ ] **Step 5: gates + commit** — `feat(db): partido casual con lados A/B, invitados y 1v1 o 2v2`

---

### Task 3: El historial muestra juntos/en contra, con quién y el deporte

**Files:** Modify `app/amigos/historial.tsx`, `app/amigos/historial.unit.test.ts`
**Est.:** ~130 líneas

- Fila casual: `{fecha} · {DISCIPLINE_LABELS[partido.sport]}` (mismo mapa que la fila de torneo, sin cast).
- Resultado con el mismo prefijo que torneo: `Juntos: Ganaron 4-2` / `En contra: Perdiste 1-3` — reusar `VERBOS_JUNTOS`/`VERBOS_CONTRA` y **borrar `VERBOS_CASUAL`** (y su comentario "siempre en contra", ya falso). La regla de marcador empatado con ganador (`2-2 · Ganó X`) se conserva; con `together`, "Ganaron"/"Perdieron".
- Línea de nombres: `con {partners} · vs {rivals}` (omitir `con` si 1v1). Los invitados se muestran por nombre, sin marca especial.
- PADEL: el marcador son los sets en mi orientación, separados por espacio (`Ganaste 6-3 4-6 6-5`); con un solo set queda igual que hoy (`Ganaste 4-2`).
- Equipo (`jugaste con Boca`) sólo si FIFA y hay equipo — ya sale así porque PADEL no tiene equipos.
- Autoría sin cambios.

- [ ] **Step 1: tests que fallan:** 2v2 juntos con invitado (texto exacto), 1v1 en contra FIFA `2-2 · Ganaste`, PADEL muestra "Pádel" y sus tres sets, la fila de torneo idéntica a hoy (snapshot del texto actual).
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: commit** — `feat(amigos): el historial casual dice juntos o en contra, con quién y qué deporte`

---

### Task 4a: El formulario — deporte en chips, 1v1/2v2, amigos o invitados

**Files:** Create `app/amigos/[playerId]/cargar-state.ts` + `cargar-state.unit.test.ts`; Modify `cargar.tsx`, `cargar.unit.test.ts`, `app/amigos/actions.ts`, `app/amigos/[playerId]/page.tsx`
**Est.:** ~320 líneas (estado puro ~70, tests ~90, componente ~130 neto, action/page ~30)

Pádel en esta tarea sigue con el pegamento de la Tarea 2 (un set, dos números); los sets de verdad son la 4b.

**`cargar-state.ts` (puro, sin React):**
- `type Slot = { kind: 'friend'; playerId: string } | { kind: 'guest'; name: string }`
- `slotsFor(mode: '1v1' | '2v2')` → claves `partner?`, `rival1`, `rival2?`.
- `slotsError(slots): string | null` — vacío, nombre de invitado en blanco, mismo amigo repetido.
- `playersFrom(slots): CasualPlayerInput[]` — lo que consume `createCasualMatch`.

**`cargar.tsx`:**
- Deporte: chips/radios con `DISCIPLINE_KINDS.map` y `DISCIPLINE_LABELS` — mismo patrón que `app/torneo/[id]/ajustes/disciplinas.tsx:60-75` (radio nativo dentro de `<label>` con `rounded-field`). Sin `datalist`, sin prop `sports`.
- Modo 1v1/2v2: mismo patrón de radios.
- Cada slot: `<select>` nativo con los amigos aceptados (`friendsOf`, filtrado `accepted`) + opción "Otro (sin cuenta)" que muestra un `<input>` de nombre. El amigo de la pantalla viene preseleccionado como `rival1`.
- FIFA: dos inputs de goles + "¿Quién ganó?" + equipos por lado (sólo FIFA).
- Los campos siguen CONTROLADOS (leer el JSDoc actual de `CasualForm` sobre el `form.reset()` de React 19 — no se pierde).
- **Editar**: mismo componente, sin la sección de jugadores (plantel fijo, se muestra como texto); sólo deporte, fecha y resultado.
- Jugadores viajan en FormData como `players` = `JSON.stringify(playersFrom(slots))`; `casualInputFrom` lo parsea y **valida la forma** (array, `side` ∈ mine/theirs, xor id/nombre) antes de llamar a `createCasualMatch` — es un borde de confianza.

- [ ] **Step 1: tests que fallan:** `cargar-state.unit.test.ts` (slots por modo, errores, `playersFrom`); `cargar.unit.test.ts` sigue conservando lo tipeado tras un error, ahora en 2v2 con un invitado.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador:** cargar un 2v2 FIFA con invitado; verlo en el historial de cada amigo; cruzar contra `psql` (`select * from casual_match_players`).
- [ ] **Step 6: commit** — `feat(amigos): cargar casual 1v1 o 2v2 con deporte en chips e invitados`

---

### Task 4b: Pádel — formato elegido y sets en dos toques

**Files:** Modify `app/amigos/[playerId]/cargar-state.ts` (+ test), `cargar.tsx`, `cargar.unit.test.ts`, `app/amigos/actions.ts`, `app/torneos/nuevo/wizard.tsx` (sólo `export` de `Stepper`)
**Est.:** ~230 líneas (estado puro ~40, tests ~80, componente ~90, action ~20)

**El dos-toques compone con N sets sin escribir nada nuevo:** `LoadState` de `app/torneo/[id]/[disciplina]/fechas/[n]/carga-state.ts` ya es `{ sets: SetScore[]; pendingWinner }`; `chooseWinner` + `chooseLoserGames` agregan UN set por par de toques, `loserGamesOptions(format)` da los botones del segundo toque e `isComplete(state, format)` (= `matchError(...) === null`) dice cuándo parar. Importarlos tal cual, con `A` = mi lado, `B` = el otro.

- **Formato:** dos `Stepper` (el componente local de `wizard.tsx:259`, ahora exportado; un `export` y nada más) con `setsToWin` y `gamesPerSet` y sus `min`/`max` de `STEPPERS`; prellenados con `defaultConfig(4).matchFormat`. Sólo se muestran con PADEL. Cambiar un stepper → `startLoad()` (los sets cargados pueden dejar de ser válidos; más simple que revalidarlos).
- **Sets:** lista de los ya cargados (`6-3 · 4-6`), los botones del toque en curso mientras `!isComplete`, y "Volver a cargar" → `startLoad()`. Sin deshacer de a un set: YAGNI.
- `cargar-state.ts` suma `formatFromSets(sets): { setsToWin; gamesPerSet }` (decisión "formato guardado": el ganador de cada set tiene `gamesPerSet` games, `setsToWin` = sets del ganador) para prellenar al editar, y `setsField(state): string` → el `JSON` de `sets` en mi orientación que lee `parseCasualResult`.
- `casualInputFrom` pasa `setsToWin`, `gamesPerSet`, `sets` tal cual (la validación es `parseCasualResult`); se borra el pegamento de un set de la Tarea 2.

- [ ] **Step 1: tests que fallan:** `formatFromSets` (`[4-2]` → 1/4; `[6-3, 4-6, 6-5]` → 2/6); dos toques arman 3 sets y el submit queda habilitado recién con `isComplete`; cambiar `gamesPerSet` vacía los sets; editar un 3 sets prellena steppers y sets.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: navegador:** cargar un pádel 2v2 a 2 sets de 6, editarlo desde la otra cuenta a 1 set de 4; cruzar `select * from casual_match_sets` contra `psql`.
- [ ] **Step 6: commit** — `feat(amigos): el pádel casual elige su formato y carga sus sets en dos toques`

---

### Task 5: Pulido de la pantalla

**Files:** Modify `app/amigos/[playerId]/page.tsx`, `app/amigos/[playerId]/cargar.tsx`, `app/amigos/page.tsx`, `app/amigos/historial.tsx`
**Est.:** ~120 líneas

- **Formulario a pedido:** `<details>` nativo con `<summary>Cargar partido</summary>`, ARRIBA del historial (cero estado de React; si el server action vuelve con error, `open` sigue porque el componente no se desmonta).
- **Encabezado del amigo:** avatar con `initials()` (`app/format.ts:36`, mismo círculo que `app/amigos/page.tsx:52`) + nombre + link `← Amigos` a `/amigos`. El `<h1>` sale de `Historial` y pasa a la página (Historial queda con la lista; ajustar su test).
- **Confirmar antes de Borrar:** dos pasos inline en `CasualMatchRow` (`Borrar` → `¿Borrar? Sí / No`), con `useState`; borrar el párrafo del JSDoc que dice "Borrar NO pide confirmación".
- **Pending states:** `SubmitButton` (`app/submit-button.tsx`, existe) en Borrar y en los `<form>` de `/amigos` (enviar/aceptar solicitud); el submit de `CasualForm` ya usa `pending` de `useActionState` — se deja.
- **Tokens:** `rounded-[14px]` → `rounded-card` en `app/amigos/page.tsx:49,78,101` (`--radius-card: 16px`, `app/globals.css:24`; 2px de diferencia, aceptado).
- **Subtítulo** `app/amigos/page.tsx:40`: "El historial de torneo con cada uno." → "Torneos y partidos casuales con cada uno."

- [ ] **Step 1: tests que fallan:** `historial.unit.test.ts` sin `<h1>`; uno de render para la confirmación de Borrar (jsdom, como `cargar.unit.test.ts`): el primer click NO envía.
- [ ] **Step 2–4:** FAIL → implementar → gates.
- [ ] **Step 5: commit** — `feat(amigos): formulario a pedido, encabezado del amigo y confirmación al borrar`

---

## Riesgos

1. **Recursión de RLS (`42P17`)** — `casual_match_players_read` no puede consultar su propia tabla como invoker → `is_casual_participant` definer. Test 5 de la Tarea 2 lo ejercita.
2. **Visibilidad antes de tener jugadores** — al insertar el partido todavía no hay participantes; sin `created_by = my_player_id()` en `casual_matches_read`, la subconsulta de `casual_match_players_insert` no ve el partido y TODO alta falla con 42501. Por eso también la RPC genera el id en vez de usar `returning`.
3. **Trigger diferido** — su error llega al COMMIT de la request de la RPC, no en el insert; el test 4 tiene que mirar el error del `.rpc()` y además que no quedó ninguna fila.
4. **Invitados y RLS** — un invitado es texto: no tiene cuenta, no lee nada, no pasa por la puerta de amistad. El riesgo de acoso de §4.5 no se reabre: un nombre tipeado no aparece en el historial de ninguna cuenta. Lo que sí: el creador puede escribir cualquier nombre — es su partido, aceptado.
5. **2v2 se multiplica** — el mismo partido aparece en la pantalla de cada amigo que jugó; borrarlo (cualquier participante con cuenta) lo saca para todos. Es §3.3 aplicado a más gente; decirlo en el JSDoc de `deleteCasualMatch`.
6. **Editar en 2v2** — cualquier participante con cuenta edita el resultado (continúa §3.1) y queda en `updated_by`; el plantel NO se edita (decisión arriba). Si el usuario quiere "sólo quien cargó", cambia una línea por política (`using (created_by = my_player_id())`).
7. **Tipos generados** — `supabase gen types` no lee grants por columna: `updated_at`/`created_by` aparecen escribibles en el update; mandarlos da 42501 en ejecución (ya documentado en `updateCasualMatch`).
8. **Cuenta borrada** — `on delete cascade` en `player_id` deja un partido desparejo (el trigger no corre en deletes). Aceptado; la lectura no asume lados parejos.
9. **Sets incoherentes por POST directo** — la base no conoce el formato (no se guarda), así que no puede decir si los sets cierran el partido; sólo `parseCasualResult` lo hace. Acotado a los partidos propios del que lo hace a mano (ver `ponytail:` de la Tarea 2).

## Lo que este plan NO hace

- Buscador de jugadores, cancelar solicitudes enviadas, vincular invitados a cuentas, editar el plantel, tie-break como perilla, detectar duplicados (§3.4). No toca `core/`, ni el torneo, ni `season_public_rules`.
