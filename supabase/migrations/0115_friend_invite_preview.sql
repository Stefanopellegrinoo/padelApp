-- amigos-faciles, S5 ─────────────────────────────────────────────────────────
--
-- `friend_invite_preview`: lo que ve quien abre `/amigo/<token>`. Devuelve
-- SÓLO lo que la pantalla necesita: el jugador que invita, su nombre y cómo
-- está con quien mira:
--
--   self     es tu propio link
--   friends  ya son amigos
--   pending  hay un pedido sin contestar, de cualquiera de los dos
--   none     nada todavía
--
-- Es la única ventana nueva a un nombre fuera de `player_display_names`
-- (0103), y es a propósito: quien comparte su link le muestra su nombre a
-- quien lo tenga. No se puede listar: hace falta el token exacto, 122 bits al
-- azar, y con un token que no existe (o que se cambió) no devuelve nada, sin
-- decir cuál de las dos. Nunca devuelve `user_id` ni el token.
--
-- Quien mira sale de `auth.uid()`. Sin un jugador propio no devuelve nada.
-- Sólo cuentan los links de jugadores que siguen con la misma cuenta
-- (`p.user_id = i.user_id`): la cascada de 0112 ya borra el link al borrar la
-- cuenta, y esto lo sostiene aunque algún día cambie esa cascada.

create or replace function public.friend_invite_preview(p_token text)
returns table (inviter_id uuid, display_name text, relation text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select id as player_id from public.players where user_id = (select auth.uid())
  )
  select p.id,
         p.display_name,
         case
           when p.id = me.player_id then 'self'
           when f.accepted_at is not null then 'friends'
           when f.id is not null then 'pending'
           else 'none'
         end
    from public.friend_invites i
    join public.players p on p.id = i.player_id and p.user_id = i.user_id
    cross join me
    left join public.friendships f
      on f.player_a = least(p.id, me.player_id)
     and f.player_b = greatest(p.id, me.player_id)
   where i.token = p_token
$$;

revoke execute on function public.friend_invite_preview(text) from public, anon;
grant  execute on function public.friend_invite_preview(text) to authenticated;
