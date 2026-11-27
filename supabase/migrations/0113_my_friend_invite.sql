-- amigos-faciles, S5 ─────────────────────────────────────────────────────────
--
-- `my_friend_invite`: tu link de amistad. La primera vez lo crea; después
-- devuelve siempre el mismo, hasta que lo cambies (0114).
--
-- Sin parámetros: el jugador sale de `auth.uid()`, así que nadie puede crear
-- ni leer el link de otro. `on conflict do nothing` y la relectura cubren dos
-- pestañas que lo piden a la vez: la segunda ve la fila de la primera.

create or replace function public.my_friend_invite()
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

  insert into public.friend_invites (player_id, user_id, token)
  values (v_player, v_uid, replace(gen_random_uuid()::text, '-', ''))
  on conflict (player_id) do nothing;

  select token into v_token
    from public.friend_invites
   where player_id = v_player
     and user_id = v_uid;

  return v_token;
end;
$$;

revoke execute on function public.my_friend_invite() from public, anon;
grant  execute on function public.my_friend_invite() to authenticated;
