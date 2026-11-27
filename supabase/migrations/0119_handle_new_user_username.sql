-- amigos-faciles, S7 ─────────────────────────────────────────────────────────
--
-- El alta (0003) ahora también guarda el @usuario que se eligió en el
-- registro (`raw_user_meta_data ->> 'username'`).
--
-- **Nunca falla por el @usuario.** Un error acá aborta el alta entera en
-- GoTrue ("Database error saving new user"): nadie podría registrarse. Por eso
-- un @usuario inválido, ya tomado, o que otra alta tomó en el mismo instante
-- (`unique_violation`), queda en `null`, y esa persona lo elige después en la
-- pantalla única. El nombre se arma exactamente igual que en 0003.
--
-- El bloque `begin ... exception` sólo reintenta si había un @usuario: una
-- `unique_violation` sin él sería de `user_id`, y ese error tiene que seguir
-- saliendo como hasta hoy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Jugador'
  );
  v_username text := lower(trim(new.raw_user_meta_data ->> 'username'));
begin
  if v_username is not null and v_username !~ '^[a-z0-9][a-z0-9._]{2,19}$' then
    v_username := null;
  end if;

  if v_username is not null then
    begin
      insert into public.players (display_name, user_id, username)
      values (v_display_name, new.id, v_username);
      return new;
    exception when unique_violation then
      -- Otro ya lo tiene: el alta sigue, sin @usuario.
      null;
    end;
  end if;

  insert into public.players (display_name, user_id)
  values (v_display_name, new.id);
  return new;
end;
$$;

-- Lo mismo que 0009: es la función del trigger, no una RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
