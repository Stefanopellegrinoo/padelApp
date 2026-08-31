-- La amistad, que es lo único que este plan agrega al modelo.
--
-- UNA fila por par, no dos. `player_a < player_b` hace las dos cosas de una:
-- fuerza un orden canónico —así el unique de abajo alcanza para que no entren
-- la fila (a,b) y la (b,a)— y prohíbe la amistad con uno mismo, porque `a < a`
-- es falso. Sin el orden, evitar el duplicado pedía un índice sobre
-- expresiones y una comprobación en cada escritura.
--
-- `accepted_at` en null ES el estado pendiente. Un enum de estados acá sería
-- tres valores para representar un booleano con fecha, y la fecha se quiere
-- igual.
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  player_a     uuid not null references public.players on delete cascade,
  player_b     uuid not null references public.players on delete cascade,
  requested_by uuid not null references public.players on delete cascade,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint friendships_ordered check (player_a < player_b),
  constraint friendships_unique  unique (player_a, player_b),
  constraint friendships_requester_is_a_member check (requested_by in (player_a, player_b))
);

create index friendships_by_player_a on public.friendships (player_a);
create index friendships_by_player_b on public.friendships (player_b);

alter table public.friendships enable row level security;

-- ── permisos ────────────────────────────────────────────────────────────────
-- LAS DOS COSAS, y este repo ya se comió las dos por separado:
--
-- 1. El CLI de Supabase no le da DML a los roles de la API: sin este `grant`,
--    `authenticated` recibe 42501 y toda la RLS de abajo es decorativa
--    (0002_rls.sql lo documenta).
-- 2. Supabase Cloud SE MEDÍA otorgándole a `anon` select/insert/update/delete
--    sobre cada tabla nueva del schema public (0009_anon_surface.sql, medido
--    en producción en su momento). Ese default YA CAMBIÓ: `supabase/config.
--    toml:19-24` documenta que la nube ya no expone entidades nuevas sin un
--    grant explícito. El `revoke` de abajo se queda igual — no depende de
--    cuál sea el default de la plataforma hoy, y es la misma defensa que ya
--    valió la pena una vez cuando ese default era el opuesto.
--
-- `update` sale de la lista de abajo a propósito: un `with check` no puede
-- comparar la fila nueva contra la vieja, así que ninguna política puede
-- impedir que quien acepta reapunte `player_a`/`player_b`/`requested_by` a
-- un par fabricado — mismo motivo que 0015_disciplines.sql:69-70 y
-- 0069_discipline_rules.sql:59. El grant de columna de más abajo es lo que
-- de verdad lo impide: sin permiso de UPDATE sobre esas tres columnas, ni
-- llegan a evaluarse contra una política.
grant select, insert, delete on public.friendships to authenticated;
grant all on public.friendships to service_role;
revoke all on public.friendships from anon;

-- Sólo `accepted_at` es escribible por un UPDATE de `authenticated`. Aceptar
-- una solicitud es la única escritura que le corresponde a la contraparte;
-- `player_a`, `player_b` y `requested_by` son identidad de la fila y se fijan
-- al pedir la amistad, no se editan después.
grant update (accepted_at) on public.friendships to authenticated;

-- ── políticas ───────────────────────────────────────────────────────────────
-- `my_player_id()` (0006) y no un join contra `players`: `players.user_id` no
-- tiene SELECT otorgado a `authenticated` a propósito, para que nadie pueda
-- correlacionar auth.uid() con un jugador desde una consulta directa.
create policy friendships_read on public.friendships
  for select to authenticated
  using (public.my_player_id() in (player_a, player_b));

-- Pedir: sólo en nombre propio, y siempre pendiente. Sin el primer check,
-- cualquiera inventa una amistad entre dos terceros; sin `accepted_at is
-- null`, cualquiera se auto-declara ya amigo de otro jugador real sin que la
-- contraparte haga nada — el flujo pedir→aceptar quedaría decorativo.
create policy friendships_request on public.friendships
  for insert to authenticated
  with check (
    public.my_player_id() = requested_by
    and public.my_player_id() in (player_a, player_b)
    and accepted_at is null
  );

-- Aceptar: la contraparte, nunca quien pidió. El `using` mira la fila como
-- está y el `with check` la fila como queda.
create policy friendships_accept on public.friendships
  for update to authenticated
  using (public.my_player_id() in (player_a, player_b) and public.my_player_id() <> requested_by)
  with check (public.my_player_id() in (player_a, player_b));

-- Borrar: cualquiera de los dos, en cualquier momento. Rechazar una solicitud
-- y dejar de ser amigos son la misma operación.
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (public.my_player_id() in (player_a, player_b));
