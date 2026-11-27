-- amigos-faciles, S7 ─────────────────────────────────────────────────────────
--
-- `choose_my_username`: elegir tu @usuario, una sola vez. Es el único camino
-- para escribirlo después del alta: `players` no tiene grants de escritura
-- para `authenticated` (0118).
--
-- El jugador sale de `auth.uid()`, nunca de un parámetro, así que nadie
-- elige el de otro. El `update ... where username is null` hace que una
-- segunda llamada no pise nada aunque lleguen dos a la vez: la segunda no
-- encuentra fila y dice "Ya elegiste". Si otro tomó el mismo @usuario en el
-- mismo instante, el `unique` lo frena y se traduce a "ya está en uso".
--
-- Devuelve el @usuario guardado (en minúsculas).
create or replace function public.choose_my_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_username text := lower(trim(coalesce(p_username, '')));
  v_player   uuid;
  v_actual   text;
  v_rows     integer;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión.';
  end if;

  if v_username !~ '^[a-z0-9][a-z0-9._]{2,19}$' then
    raise exception 'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.';
  end if;

  select id, username into v_player, v_actual from public.players where user_id = v_uid;
  if v_player is null then
    raise exception 'Tu cuenta no tiene un jugador.';
  end if;
  if v_actual is not null then
    raise exception 'Ya elegiste tu @usuario.';
  end if;

  begin
    update public.players
       set username = v_username
     where id = v_player
       and username is null;
    get diagnostics v_rows = row_count;
  exception when unique_violation then
    raise exception 'Ese @usuario ya está en uso.';
  end;

  if v_rows = 0 then
    raise exception 'Ya elegiste tu @usuario.';
  end if;

  return v_username;
end;
$$;

revoke execute on function public.choose_my_username(text) from public, anon;
grant  execute on function public.choose_my_username(text) to authenticated;
