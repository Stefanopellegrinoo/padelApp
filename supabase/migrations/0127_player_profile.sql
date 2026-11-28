-- amigos-faciles, S9 ─────────────────────────────────────────────────────────
--
-- `player_profile`: lo que muestra `/perfil/<id>` de un jugador. Su nombre, su
-- @usuario (null si todavía no lo eligió) y si la cuenta sigue (`has_account`).
--
-- No abre nada que la app no viera ya. Se ve en dos casos, y en ningún otro:
--
-- - Hay contexto con él: la regla de `player_display_names` (0103) tal cual,
--   llamándola (vos, el admin de un torneo donde juega, un torneo compartido,
--   un amigo o un pedido pendiente, un partido casual). Ahí el nombre ya se
--   veía, y si tiene cuenta ya lo decía `players_with_account` (0117).
-- - Se lo puede encontrar por el buscador: la condición de
--   `search_players_by_username` (0124): eligió su @usuario, no apagó "Que me
--   encuentren por mi usuario" (0123) y tiene cuenta. Es lo mismo que ya
--   devuelve el buscador, por id en vez de por el comienzo del @usuario.
--
-- De cualquier otro id no devuelve nada, exista o no: no sirve para saber si
-- un id es un jugador, si tiene cuenta ni cuál es su @usuario.
--
-- Devuelve el jugador, su nombre, su @usuario y un booleano. Nunca `user_id`,
-- el mail ni el interruptor. Sólo con sesión (`authenticated`); `anon` no la
-- ejecuta.
create or replace function public.player_profile(p_player uuid)
returns table (id uuid, display_name text, username text, has_account boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.username, p.user_id is not null
    from public.players p
   where p.id = p_player
     and (select auth.uid()) is not null
     and (
       exists (select 1 from public.player_display_names(array[p_player]) v where v.id = p.id)
       or (p.username is not null and p.discoverable and p.user_id is not null)
     )
$$;

revoke execute on function public.player_profile(uuid) from public, anon;
grant  execute on function public.player_profile(uuid) to authenticated;
