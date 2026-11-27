-- amigos-faciles, S5 ─────────────────────────────────────────────────────────
--
-- `rotate_friend_invite`: "Cambiar el link". Pone un token nuevo y el viejo
-- deja de existir, así que un link repartido antes ya no muestra el nombre ni
-- suma a nadie (0115, 0116 buscan por token). Las amistades ya hechas viven en
-- `friendships` y no se tocan. Mismo token que `regenerate_invite_token`
-- (0105).
--
-- Sin parámetros: sólo cambia el link de quien llama (`auth.uid()`). Si
-- todavía no tenía uno, lo crea.

create or replace function public.rotate_friend_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_player uuid;
  v_token  text;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión.';
  end if;

  select id into v_player from public.players where user_id = v_uid;
  if v_player is null then
    raise exception 'Tu cuenta no tiene un jugador.';
  end if;

  insert into public.friend_invites as fi (player_id, user_id, token)
  values (v_player, v_uid, replace(gen_random_uuid()::text, '-', ''))
  on conflict (player_id) do update
     set token = excluded.token,
         updated_at = now()
   where fi.user_id = v_uid
  returning fi.token into v_token;

  if v_token is null then
    raise exception 'No se pudo cambiar el link.';
  end if;

  return v_token;
end;
$$;

revoke execute on function public.rotate_friend_invite() from public, anon;
grant  execute on function public.rotate_friend_invite() to authenticated;
