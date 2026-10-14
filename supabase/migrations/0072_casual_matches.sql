-- El partido casual (docs/historial-entre-amigos.md §4), rediseñado por
-- docs/plan-amigos-deporte-y-2v2.md (Tarea 2): el deporte es `PADEL | FIFA`,
-- se juega 1v1 o 2v2, y cada lado puede tener amigos con cuenta o invitados
-- (sólo un nombre). Tres tablas: el partido, quién jugó de qué lado, y los
-- sets si fue pádel.
--
-- Este archivo se REESCRIBIÓ en el lugar: nunca llegó a `main` (`git log
-- main -- supabase/migrations/0072_casual_matches.sql` vacío), así que no hay
-- datos que migrar. Trae SÓLO las tablas, sus permisos y el trigger de
-- `updated_at`. El resto vive aparte por la regla "una función por migración"
-- (`db/migrations.unit.test.ts`):
--   - `0090_is_casual_participant.sql`: el helper y TODAS las políticas (las
--     políticas lo necesitan, así que van con él).
--   - `0091_casual_match_shape.sql`: la forma del partido (1v1 o 2v2, quien
--     carga juega), un constraint trigger diferido.
--   - `0092_save_casual_match.sql`: el único camino de escritura, la RPC.
-- Entre éste y `0090` las tres tablas tienen RLS prendida y ninguna política:
-- nadie lee ni escribe nada, que es el estado seguro.
create table public.casual_matches (
  id          uuid primary key default gen_random_uuid(),
  sport       text not null check (sport in ('PADEL', 'FIFA')),
  played_on   date not null,
  -- Quién ganó es un dato PROPIO, nunca deducido del marcador: un 2-2 de FIFA
  -- que termina con ganador se definió por penales, y ningún cálculo sobre el
  -- marcador puede decir eso (diseño §4.2, §4.3). Es un LADO, no una persona:
  -- en un 2v2 ganan dos. `null` = empataron (sólo FIFA, ver abajo).
  winner_side text check (winner_side in ('A', 'B')),
  -- Goles: sólo FIFA. El resultado de pádel vive en `casual_match_sets`.
  score_a     int check (score_a >= 0),
  score_b     int check (score_b >= 0),
  -- `is null or length(trim(x)) > 0`: mismo criterio que
  -- `0001_schema.sql:6`/`0047_award_lines.sql:18` -- "sin equipo" tiene una
  -- sola forma de decirse (`null`), no dos (`null` o `''`).
  team_a      text check (team_a is null or length(trim(team_a)) > 0),
  team_b      text check (team_b is null or length(trim(team_b)) > 0),
  created_by  uuid not null references public.players,
  updated_by  uuid not null references public.players,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- O están los dos números o ninguno -- un marcador a medias no es un
  -- marcador. NO hay campo "por penales": es derivable de (marcador
  -- empatado + winner_side no nulo), y guardarlo aparte sólo permite un
  -- registro que se contradice solo (§4.3).
  constraint casual_score_pair  check ((score_a is null) = (score_b is null)),
  -- "Con qué equipo jugaste" es de FIFA; en pádel no existe.
  constraint casual_teams_fifa  check (sport = 'FIFA' or (team_a is null and team_b is null)),
  -- pádel: sin goles, sin empate; el resultado vive en casual_match_sets
  constraint casual_padel_shape check (sport <> 'PADEL' or (score_a is null and winner_side is not null))
);
-- Lo que este archivo YA NO tiene, a propósito: `casual_authors_play` (los
-- autores tienen que haber jugado). `created_by` lo cubre el trigger de forma
-- (0091: quien carga es uno de los jugadores), y `updated_by` el `with check`
-- de `casual_matches_update` (0090: sólo un participante edita, y firma como
-- él mismo). Un CHECK no puede mirar otra tabla, y los jugadores ahora viven
-- en otra.
--
-- Lo que la base NO chequea, a propósito: que los sets cierren un partido
-- legal para el formato elegido, y que `winner_side` coincida con ellos. El
-- formato no se guarda y "legal" es `matchError`, que vive en TypeScript: lo
-- valida `parseCasualResult` en el único camino de escritura (la RPC vía
-- `db/friends.ts`). ponytail: un POST directo a la RPC puede guardar sets
-- incoherentes en SU propio partido; si eso importa, un trigger diferido que
-- cuente sets por lado.

-- Quién jugó y de qué lado. Una fila por jugador: con cuenta (`player_id`) o
-- invitado (`guest_name`), nunca las dos ni ninguna.
--
-- `player_id` apunta a `players` directamente, NO a `friendships`: dejar de
-- ser amigos no borra los partidos ya cargados (§4.5, último párrafo) -- si
-- la FK fuera a `friendships`, borrar esa fila se llevaría puesta la
-- historia. `on delete cascade` en `player_id`: si se borra una cuenta, su
-- fila desaparece y el partido queda desparejo (el trigger de forma de 0091
-- corre en INSERT, no en este delete). Aceptado: la versión anterior de esta
-- tabla cascadeaba el partido entero, mismo destino o peor.
create table public.casual_match_players (
  match_id   uuid not null references public.casual_matches on delete cascade,
  side       text not null check (side in ('A', 'B')),
  player_id  uuid references public.players on delete cascade,
  guest_name text check (guest_name is null or length(trim(guest_name)) > 0),
  constraint casual_player_xor check (num_nonnulls(player_id, guest_name) = 1),
  -- NULLs distintos: varios invitados en el mismo partido entran sin chocar,
  -- pero la misma cuenta no puede estar dos veces (ni de los dos lados).
  unique (match_id, player_id)
);
-- `match_id` ya queda indexado por la `unique` de arriba (es su primera
-- columna). Éste es el de "¿en qué partidos jugó X?": toda lectura del
-- historial (`historyWith`) y el helper de RLS (0090) buscan por `player_id`.
create index casual_match_players_by_player on public.casual_match_players (player_id);

-- Espejo de match_sets (0001_schema.sql:194-204), mismo nombre de columnas.
-- La PK compuesta reemplaza el `id` + `unique (match_id, set_number)` de
-- allá: acá nadie referencia un set suelto.
create table public.casual_match_sets (
  match_id   uuid not null references public.casual_matches on delete cascade,
  set_number int  not null check (set_number >= 1),
  games_a    int  not null check (games_a >= 0),
  games_b    int  not null check (games_b >= 0),
  primary key (match_id, set_number),
  -- En pádel no hay set empatado -- mismo argumento que `match_sets_no_draw`.
  constraint casual_sets_no_draw check (games_a <> games_b)
);

alter table public.casual_matches       enable row level security;
alter table public.casual_match_players enable row level security;
alter table public.casual_match_sets    enable row level security;

-- ── permisos ────────────────────────────────────────────────────────────────
-- Las dos cosas de siempre, y este repo ya se comió las dos por separado
-- (0002, 0009 -- detalle completo en 0070:29-49): el `grant` porque el CLI
-- de Supabase no le da DML a los roles de la API solo, y el `revoke` de
-- `anon` porque la nube alguna vez otorgó DML por defecto a tabla nueva.
grant select, insert, delete on public.casual_matches to authenticated;
-- Jugadores: sin update ni delete -- el plantel es fijo una vez cargado. Se
-- van sólo con el partido (`on delete cascade`, y las acciones referenciales
-- no pasan por RLS ni por grants).
grant select, insert on public.casual_match_players to authenticated;
-- Sets: sin update -- editar el resultado es reemplazarlos (borrar e
-- insertar, en la misma transacción de la RPC, 0092).
grant select, insert, delete on public.casual_match_sets to authenticated;
grant all on public.casual_matches, public.casual_match_players, public.casual_match_sets to service_role;
revoke all on public.casual_matches, public.casual_match_players, public.casual_match_sets from anon;

-- Sólo estas columnas son escribibles por un UPDATE de `authenticated`.
-- `created_by` y `created_at` son identidad de la fila y se fijan al cargar
-- el partido: un `with check` no puede comparar la fila nueva contra la vieja
-- (misma lección que 0069:59 y 0070:58), así que lo que de verdad las congela
-- es no darles permiso de UPDATE -- sin él, ni llegan a evaluarse contra una
-- política. Los jugadores ya no son columnas de esta tabla: los congela que
-- `casual_match_players` no tenga grant de update/delete.
--
-- `updated_at` sale de esta lista por un motivo DISTINTO al de las de
-- arriba: no es identidad, es la prueba de que algo cambió (§3.2 -- "que
-- puedan ver que algo cambió"). Si el cliente pudiera mandarla, un update
-- podría pisarla con cualquier fecha, incluso una pasada, y "tocado último
-- por Juan" (que sí queda forzado por el `with check` de
-- `casual_matches_update`, 0090) mentiría sobre CUÁNDO. La escribe el trigger
-- de acá abajo, siempre -- así ningún camino de escritura, ni uno futuro que
-- se olvide de setearla a mano, puede dejarla mintiendo.
grant update (sport, played_on, winner_side, score_a, score_b, team_a, team_b, updated_by)
  on public.casual_matches to authenticated;

-- El trigger, no la aplicación: mismo argumento que
-- `0045_matchdays_formato_immutable_after_draft.sql` para `formato` -- un
-- guard de TypeScript no cubre un PATCH directo, y acá la apuesta es
-- mayor, porque tiene que valer para TODO camino de escritura, incluidos
-- los que todavía no existen. Sin `security definer`: no toca otra tabla,
-- sólo la fila que la misma sentencia ya está actualizando.
create function public.casual_matches_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger casual_matches_touch_updated_at
  before update on public.casual_matches
  for each row execute function public.casual_matches_touch_updated_at();

-- Postgres otorga EXECUTE a PUBLIC en toda función nueva -- la lección de
-- `0002_rls.sql:83-93`, que ya mordió a este repo una vez. Un trigger no se
-- invoca a mano (Postgres lo rechaza: "trigger functions can only be
-- called as triggers"), así que esto no cierra un agujero real hoy, pero es
-- el mismo reflejo que el resto del repo exige para TODA función nueva, sin
-- excepción para "esta no se puede llamar directo".
revoke execute on function public.casual_matches_touch_updated_at() from public, anon;
