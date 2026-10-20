-- security-hardening, S3 ─────────────────────────────────────────────────────
--
-- `players_read` (0002) es `for select using (true)`: cualquier `authenticated`
-- puede leer `id, display_name` de TODOS los jugadores —el directorio entero—
-- con un `select id, display_name from players`. La app sólo necesita resolver
-- NOMBRES de jugadores con los que el que llama tiene un contexto (él mismo, el
-- admin de su temporada, un amigo, alguien de su torneo o de un partido casual).
--
-- El fix: cerrar la lectura directa (drop de la policy + revoke del select a
-- `authenticated`/`anon`) y exponer la resolución de nombres por una función
-- `security definer` que filtra por contexto. `service_role` conserva el select
-- (los andamios de `db/test/` y el trigger de alta lo necesitan). Las pantallas
-- siguen resolviendo nombres por `player_display_names` (vía `playerNames`).
--
-- No-destructivo y reversible (L5): sólo privilegios y una función nueva.

drop policy if exists players_read on public.players;
revoke select on public.players from authenticated, anon;

create or replace function public.player_display_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    -- El player del que llama (null si no tiene ninguno). `auth.uid()` es el
    -- JWT del request, preservado a través de las funciones security definer.
    select (select id from public.players where user_id = (select auth.uid())) as player_id
  )
  select p.id, p.display_name
    from public.players p, me
   where p.id = any(p_ids)
     and (
       -- él mismo
       p.id = me.player_id
       -- el admin de una temporada donde p tiene un asiento
       or exists (
         select 1
           from public.seasons s
           join public.entries e on e.season_id = s.id and e.player_id = p.id
          where s.created_by = (select auth.uid())
       )
       -- comparten temporada (los dos con asiento en la misma)
       or exists (
         select 1
           from public.entries a
           join public.entries b on b.season_id = a.season_id and b.player_id = p.id
          where a.player_id = me.player_id
       )
       -- amigos
       or exists (
         select 1
           from public.friendships f
          where (f.player_a = me.player_id and f.player_b = p.id)
             or (f.player_a = p.id and f.player_b = me.player_id)
       )
       -- comparten un partido casual
       or exists (
         select 1
           from public.casual_match_players a
           join public.casual_match_players b on b.match_id = a.match_id and b.player_id = p.id
          where a.player_id = me.player_id
       )
     )
$$;

revoke execute on function public.player_display_names(uuid[]) from public, anon;
grant  execute on function public.player_display_names(uuid[]) to authenticated;
