-- borrar-cuenta, S2-S3 (odd/tasks/borrar-cuenta.md) ─────────────────────────
--
-- Borra la cuenta "desvinculando": el login (`auth.users`) y las amistades se
-- van; el `players` queda sin `user_id`, igual que un jugador tipeado por el
-- admin y nunca reclamado. Quien organiza un torneo primero lo pasa
-- (`transfer_season_admin`, 0107) o lo borra.

-- ── delete_my_account ───────────────────────────────────────────────────────
-- El orden importa: `players.user_id` es ON DELETE CASCADE, así que el jugador
-- se desvincula ANTES de borrar el usuario; si no, se lo lleva puesto. Las
-- amistades se borran a mano porque, con el jugador vivo, ya no las borra la
-- cascada. Todo es una sola transacción: si algo falla, no se borra nada.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_player uuid;
  v_admin  text;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión.';
  end if;

  select string_agg(name, ', ' order by name) into v_admin
    from public.seasons
   where created_by = v_uid;
  if v_admin is not null then
    raise exception 'Organizás %. Pasale la administración a otro jugador o borrá el torneo antes de borrar tu cuenta.', v_admin;
  end if;

  select id into v_player from public.players where user_id = v_uid;

  delete from public.friendships
   where player_a = v_player or player_b = v_player;

  update public.players set user_id = null where user_id = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;
