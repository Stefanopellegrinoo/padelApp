-- ── helpers ──────────────────────────────────────────────────────────────────
-- security definer para que no dependan de las políticas de las tablas que
-- consultan: si `entries` sólo fuera legible por participantes, preguntar
-- "¿soy participante?" leyendo `entries` sería circular.
--
-- `search_path = ''` y todo calificado, no `= public`. Con `public` en el path,
-- `pg_temp` se sigue buscando PRIMERO para nombres de relación, así que un
-- `create temp table seasons(...)` desde una conexión directa haría que un
-- `from seasons` sin calificar resuelva a la tabla del atacante.

create or replace function public.is_participant(p_season uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seasons s
    where s.id = p_season and s.created_by = (select auth.uid())
  ) or exists (
    select 1
      from public.entries e
      join public.players p on p.id = e.player_id
     where e.season_id = p_season and p.user_id = (select auth.uid())
  )
$$;

create or replace function public.is_season_admin(p_season uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seasons s
    where s.id = p_season and s.created_by = (select auth.uid())
  )
$$;

create or replace function public.matchday_season(p_matchday uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select season_id from public.matchdays where id = p_matchday
$$;

create or replace function public.match_season(p_match uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.season_id
    from public.matchdays m
    join public.matches x on x.matchday_id = m.id
   where x.id = p_match
$$;

/* Un resultado sólo se toca con la fecha en juego. En DRAFT no hay partidos y
   en CLOSED los awards ya están congelados: escribir ahí deja la tabla
   histórica diciendo una cosa y los puntos otra, sin que nada falle. */
create or replace function public.match_is_open(p_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.matchdays m
      join public.matches x on x.matchday_id = m.id
     where x.id = p_match and m.status = 'OPEN'
  )
$$;

-- Postgres otorga EXECUTE a PUBLIC en toda función nueva, y Supabase además
-- tiene default privileges para anon. Un `revoke ... from anon` solo NO alcanza:
-- hay que sacarle el grant a PUBLIC. Sin esto, cualquiera sin cuenta ejecuta
-- estas funciones por PostgREST.
revoke execute on function
    public.is_participant(uuid),
    public.is_season_admin(uuid),
    public.matchday_season(uuid),
    public.match_season(uuid),
    public.match_is_open(uuid)
  from public, anon;

grant execute on function
    public.is_participant(uuid),
    public.is_season_admin(uuid),
    public.matchday_season(uuid),
    public.match_season(uuid),
    public.match_is_open(uuid)
  to authenticated;

-- ── el permiso de base, sin el cual nada de lo de abajo existe ───────────────
-- Verificado contra la base: esta versión del CLI de Supabase NO le da DML a los
-- roles de la API. El ACL de las diez tablas nace en `Dxtm` —TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN— sin una letra de select/insert/update/delete,
-- así que `anon`, `authenticated` y `service_role` recibían 42501 en todas.
--
-- Y una política NUNCA ensancha un privilegio que no existe: RLS filtra filas
-- sobre un permiso ya otorgado. Sin este grant, cada policy de este archivo es
-- decorativa y todo el Plan 2 de la Task 7 en adelante falla en la primera query.
--
-- `service_role` va incluido porque los andamios de `db/test/` escriben con esa
-- llave: saltea RLS, pero no saltea los privilegios de tabla.
-- `anon` queda AFUERA a propósito: el modelo de esta tarea es que no ve ni una
-- fila, y no hay razón para darle superficie que después haya que tapar.
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;

-- ── prender RLS en todo ──────────────────────────────────────────────────────
alter table public.players     enable row level security;
alter table public.seasons     enable row level security;
alter table public.matchdays   enable row level security;
alter table public.entries     enable row level security;
alter table public.attendances enable row level security;
alter table public.pair_locks  enable row level security;
alter table public.pairs       enable row level security;
alter table public.matches     enable row level security;
alter table public.match_sets  enable row level security;
alter table public.awards      enable row level security;

-- ── players ──────────────────────────────────────────────────────────────────
-- Nadie inserta a mano: el trigger de alta lo hace (Task 7). Y nadie edita:
-- editarse el nombre es una pantalla del Plan 3, así que hasta entonces no hay
-- política de update — una política sin pantalla es superficie de ataque gratis.
create policy players_read on public.players
  for select to authenticated using (true);

-- `user_id` es el UUID de auth.users: es de la persona, no del grupo. Una
-- revocación de columna NO tiene efecto si el privilegio está otorgado a nivel
-- tabla, así que hay que revocar la tabla y volver a otorgar por columna.
revoke select on public.players from authenticated, anon;
grant  select (id, display_name, created_at) on public.players to authenticated;

-- ── seasons ──────────────────────────────────────────────────────────────────
create policy seasons_read on public.seasons
  for select to authenticated using (public.is_participant(id));

create policy seasons_insert on public.seasons
  for insert to authenticated with check (created_by = (select auth.uid()));

create policy seasons_update on public.seasons
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy seasons_delete on public.seasons
  for delete to authenticated using (created_by = (select auth.uid()));

-- ── tablas con season_id propio ──────────────────────────────────────────────
create policy entries_read on public.entries
  for select to authenticated using (public.is_participant(season_id));

create policy entries_write on public.entries
  for all to authenticated
  using (public.is_season_admin(season_id))
  with check (public.is_season_admin(season_id));

create policy matchdays_read on public.matchdays
  for select to authenticated using (public.is_participant(season_id));

create policy matchdays_write on public.matchdays
  for all to authenticated
  using (public.is_season_admin(season_id))
  with check (public.is_season_admin(season_id));

-- ── tablas que llegan a la temporada por su fecha ────────────────────────────
create policy attendances_read on public.attendances
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy attendances_write on public.attendances
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy pair_locks_read on public.pair_locks
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy pair_locks_write on public.pair_locks
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy pairs_read on public.pairs
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy pairs_write on public.pairs
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy matches_read on public.matches
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy matches_write on public.matches
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy awards_read on public.awards
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy awards_write on public.awards
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

-- ── match_sets, que llega por el partido ─────────────────────────────────────
create policy match_sets_read on public.match_sets
  for select to authenticated using (public.is_participant(public.match_season(match_id)));

-- El `match_is_open` es lo que impide reescribir el resultado de una fecha ya
-- cerrada. Sin él, los awards congelados y la tabla que sale de match_sets
-- pueden decir cosas distintas y ninguna pantalla se rompe.
create policy match_sets_write on public.match_sets
  for all to authenticated
  using (public.is_season_admin(public.match_season(match_id)) and public.match_is_open(match_id))
  with check (public.is_season_admin(public.match_season(match_id)) and public.match_is_open(match_id));

-- ── el estado de la fecha lo mueven las funciones, no un PATCH ───────────────
-- Sin esto, `PATCH /matchdays?id=eq.X {"status":"OPEN"}` reabre cualquier fecha
-- salteando los controles de reopen_matchday y dejando los awards colgados.
-- Las políticas de arriba no lo frenan: PostgREST no distingue qué columna se
-- actualizó, que es el mismo motivo por el que el reclamo de asiento va por
-- función (Task 8).
revoke insert, update on public.matchdays from authenticated, anon;
grant  insert (season_id, number, played_on) on public.matchdays to authenticated;
grant  update (played_on)                    on public.matchdays to authenticated;
