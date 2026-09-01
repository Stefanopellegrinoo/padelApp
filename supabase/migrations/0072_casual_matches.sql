-- El partido casual (docs/historial-entre-amigos.md §4), tarea 1 de la
-- rebanada 2b -- SÓLO la tabla, su RLS y sus permisos. Nada la lee ni la
-- escribe todavía: la lectura conjunta con los partidos de torneo es la
-- tarea 2, y la pantalla que carga uno es la tarea 4. Hasta que esas
-- lleguen, esta tabla existe y no la usa nadie -- misma postura que
-- `0069_discipline_rules.sql` con `rules_text` recién agregada.
--
-- `player_a`/`player_b` apuntan a `players` directamente, NO a `friendships`:
-- dejar de ser amigos no borra los partidos ya cargados (§4.5, último
-- párrafo) -- si la FK fuera a `friendships`, borrar esa fila se llevaría
-- puesta la historia.
create table public.casual_matches (
  id          uuid primary key default gen_random_uuid(),
  player_a    uuid not null references public.players on delete cascade,
  player_b    uuid not null references public.players on delete cascade,
  sport       text not null check (length(trim(sport)) > 0),
  played_on   date not null,
  -- Quién ganó es un dato PROPIO, nunca deducido del marcador: un 2-2 que
  -- termina con ganador se definió por penales, y ningún cálculo sobre el
  -- marcador puede decir eso (diseño §4.2, §4.3). `null` = empataron.
  winner      uuid references public.players,
  score_a     int,
  score_b     int,
  team_a      text,
  team_b      text,
  created_by  uuid not null references public.players,
  updated_by  uuid not null references public.players,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Mismo truco que `friendships` (0070:12-22): orden canónico, así que
  -- (a,b) y (b,a) son el mismo par y un partido contra uno mismo (`a < a`)
  -- es imposible.
  constraint casual_ordered      check (player_a < player_b),
  -- El ganador tiene que ser uno de los dos que jugaron -- sin esto la fila
  -- puede afirmar que ganó un tercero que ni participó.
  constraint casual_winner_plays check (winner is null or winner in (player_a, player_b)),
  -- O están los dos números o ninguno -- un marcador a medias no es un
  -- marcador. NO hay campo "por penales": es derivable de (marcador
  -- empatado + winner no nulo), y guardarlo aparte sólo permite un registro
  -- que se contradice solo (§4.3).
  constraint casual_score_pair   check ((score_a is null) = (score_b is null))
);

-- Mismo par que `friendships` (0070:24-25) y por la misma razón: toda
-- lectura de este historial busca por `player_id`, de un lado o del otro
-- (tarea 2), nunca por `id`.
create index casual_matches_by_player_a on public.casual_matches (player_a);
create index casual_matches_by_player_b on public.casual_matches (player_b);

alter table public.casual_matches enable row level security;

-- ── permisos ────────────────────────────────────────────────────────────────
-- Las dos cosas de siempre, y este repo ya se comió las dos por separado
-- (0002, 0009 -- detalle completo en 0070:27-35): el `grant` porque el CLI
-- de Supabase no le da DML a los roles de la API solo, y el `revoke` de
-- `anon` porque la nube alguna vez otorgó DML por defecto a tabla nueva.
grant select, insert, delete on public.casual_matches to authenticated;
grant all on public.casual_matches to service_role;
revoke all on public.casual_matches from anon;

-- Sólo estas columnas son escribibles por un UPDATE de `authenticated`.
-- `player_a`, `player_b`, `created_by` y `created_at` son identidad de la
-- fila y se fijan al cargar el partido: un `with check` no puede comparar
-- la fila nueva contra la vieja (misma lección que 0069:59 y 0070:58), así
-- que lo que de verdad las congela es no darles permiso de UPDATE -- sin
-- él, ni llegan a evaluarse contra una política.
grant update (sport, played_on, winner, score_a, score_b, team_a, team_b, updated_by, updated_at)
  on public.casual_matches to authenticated;

-- ── políticas ───────────────────────────────────────────────────────────────
-- Terreno nuevo: toda política de este repo hasta acá se apoya en la
-- temporada (`is_participant`, `is_season_admin`, 0002_rls.sql) -- acá no
-- hay ninguna.
create policy casual_matches_read on public.casual_matches
  for select to authenticated
  using (public.my_player_id() in (player_a, player_b));

-- El insert exige las tres cosas a la vez, y la tercera es la que de verdad
-- importa -- éste es el párrafo más importante del archivo (§4.5).
--
-- Leer el historial NO chequea amistad, y está bien: la RLS de `matches` ya
-- acota todo a temporadas donde el que consulta participa, así que pedir
-- el historial de un desconocido devuelve cero filas ahí -- el partido de
-- torneo tiene esa RLS aguas arriba respaldándolo. EL CASUAL NO TIENE
-- NINGUNA. Si este insert sólo pidiera "soy uno de los dos", cualquiera
-- fabrica "le gané 5-0 a [player_id de cualquiera]" contra un desconocido,
-- y esa persona lo ve en su propio historial, porque la lectura está
-- abierta a propósito. La condición 3 no es una formalidad: es un canal de
-- acoso, y esto lo cierra. Sin una amistad ACEPTADA entre los dos, no hay
-- insert, sin importar qué digan las otras dos condiciones.
create policy casual_matches_insert on public.casual_matches
  for insert to authenticated
  with check (
    public.my_player_id() in (player_a, player_b)
    and created_by = public.my_player_id()
    and updated_by = public.my_player_id()
    and exists (
      select 1
        from public.friendships f
       where f.player_a = casual_matches.player_a
         and f.player_b = casual_matches.player_b
         and f.accepted_at is not null
    )
  );

-- El `exists` de arriba compara sin ordenar de nuevo el par: funciona
-- porque `friendships` (0070) y esta tabla comparten el MISMO criterio de
-- orden canónico (`player_a < player_b`), así que dos UUID cualesquiera
-- ordenan igual en las dos tablas -- no hace falta un `or` con el par al
-- revés. Y `casual_matches.player_a`/`.player_b`, calificados, son
-- necesarios y no cosméticos: dentro del `exists`, un `player_a` sin
-- calificar resolvería contra el alias `f` (la subconsulta lo tapa), no
-- contra la fila que se está insertando -- y la puerta quedaría
-- comparando `f.player_a` contra sí mismo, siempre cierto.
--
-- Actualizar: cualquiera de los dos puede editar (§3.1), y el `with check`
-- sólo exige dejar asentado quién tocó último -- no repite la membresía
-- porque `player_a`/`player_b` ya están congelados por el grant de columna
-- de arriba.
create policy casual_matches_update on public.casual_matches
  for update to authenticated
  using (public.my_player_id() in (player_a, player_b))
  with check (updated_by = public.my_player_id());

-- Borrar: cualquiera de los dos, en cualquier momento (§3.3) -- si tu
-- amigo te borra los partidos que perdió, es un problema de amigo, no de
-- software.
create policy casual_matches_delete on public.casual_matches
  for delete to authenticated
  using (public.my_player_id() in (player_a, player_b));
