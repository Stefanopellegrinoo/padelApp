-- amigos-faciles, S5 ─────────────────────────────────────────────────────────
--
-- `accept_friend_invite`: "Sumarme como amigo". Quien llama y quien invitó
-- quedan amigos al toque: compartir el link ya fue el sí de quien invita
-- ("Amigos al toque", como el link de invitación al torneo).
--
-- Es la única escritura que deja nacer una amistad ya aceptada, algo que
-- `friendships_request` (0070) le prohíbe a un insert directo. Por eso es
-- estrecha:
--
-- * Las dos puntas salen de la base, nunca de un parámetro: quien llama, de
--   `auth.uid()`; quien invita, del token. No hay forma de armar la amistad
--   entre dos terceros ni de sumarse a alguien sin su link.
-- * Sin pedido entre los dos, inserta la fila aceptada, en el orden canónico
--   (`player_a < player_b`) y con `requested_by` = quien invitó: fue quien
--   ofreció. Con un pedido pendiente, en cualquier dirección, lo acepta y deja
--   su `requested_by` como estaba (decisión del orquestador). Ya amigos: no
--   toca nada, ni la fecha.
-- * Un token que no existe o que se cambió (0114): "Este link ya no anda,
--   pedile uno nuevo", el mismo mensaje para los dos casos. El propio link no
--   se acepta.
--
-- Devuelve el jugador que invitó, para ir a su historial.

create or replace function public.accept_friend_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_me      uuid;
  v_inviter uuid;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión.';
  end if;

  select id into v_me from public.players where user_id = v_uid;
  if v_me is null then
    raise exception 'Tu cuenta no tiene un jugador.';
  end if;

  select i.player_id into v_inviter
    from public.friend_invites i
    join public.players p on p.id = i.player_id and p.user_id = i.user_id
   where i.token = p_token;
  if v_inviter is null then
    raise exception 'Este link ya no anda, pedile uno nuevo';
  end if;

  if v_inviter = v_me then
    raise exception 'No te podés agregar a vos mismo como amigo.';
  end if;

  insert into public.friendships as f (player_a, player_b, requested_by, accepted_at)
  values (least(v_me, v_inviter), greatest(v_me, v_inviter), v_inviter, now())
  on conflict on constraint friendships_unique do update
     set accepted_at = now()
   where f.accepted_at is null;

  return v_inviter;
end;
$$;

revoke execute on function public.accept_friend_invite(text) from public, anon;
grant  execute on function public.accept_friend_invite(text) to authenticated;
