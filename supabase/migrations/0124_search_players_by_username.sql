-- amigos-faciles, S8 ─────────────────────────────────────────────────────────
--
-- `search_players_by_username`: el buscador de Amigos. Escribís el comienzo
-- de un @usuario y trae hasta 10 que empiezan así, en orden alfabético.
--
-- **Es la única lectura de `players` que no pide contexto con el otro**
-- (0103 cerró el directorio y `player_display_names` sólo resuelve gente de
-- tus torneos, amigos y partidos). Por eso todo lo que la acota vive acá,
-- del lado de la base, y no en la pantalla:
--
-- - Sólo con sesión (`authenticated`); `anon` no la ejecuta.
-- - Lo que escribiste se limpia como en la app (`normalizeUsername`): sin la
--   @ de adelante, sin espacios, en minúsculas. Con menos de 3 caracteres, o
--   con uno que un @usuario no puede tener, no busca.
-- - Por el comienzo y nada más: `%`, `_` y `\` se escapan, así que un `_` de
--   la búsqueda es un guion bajo (que sí vale en un @usuario) y no "cualquier
--   letra".
-- - Sólo quien tiene cuenta (`user_id`, así no salen las borradas, 0108),
--   eligió su @usuario y no apagó "Que me encuentren por mi usuario" (0123).
--   Vos no salís.
-- - Nunca más de 10, por @usuario en orden de bytes (`collate "C"`): el
--   mismo orden en cualquier base, sin depender del idioma del servidor.
-- - Devuelve el jugador, su nombre y su @usuario. Nunca `user_id`, el mail ni
--   el interruptor: la cuenta no se puede correlacionar con el jugador.
--
-- Lo que no frena: con muchas búsquedas de 3 letras y alargando las que
-- llenan 10, alguien con cuenta puede juntar los @usuario y nombres de
-- quienes no apagaron el interruptor. Es el precio de buscar por el comienzo
-- (odd/tasks/amigos-faciles.md, S8): el tope lo vuelve lento, no imposible.
create or replace function public.search_players_by_username(p_query text)
returns table (id uuid, display_name text, username text)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select lower(btrim(regexp_replace(btrim(coalesce(p_query, '')), '^@', ''))) as text
  )
  select p.id, p.display_name, p.username
    from public.players p, q
   where (select auth.uid()) is not null
     and length(q.text) between 3 and 20
     and q.text ~ '^[a-z0-9._]+$'
     and p.username like replace(replace(replace(q.text, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
     and p.user_id is not null
     and p.user_id <> (select auth.uid())
     and p.discoverable
   order by p.username collate "C"
   limit 10
$$;

revoke execute on function public.search_players_by_username(text) from public, anon;
grant  execute on function public.search_players_by_username(text) to authenticated;
