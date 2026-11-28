-- amigos-faciles, S8 ─────────────────────────────────────────────────────────
--
-- `set_my_discoverable`: prender o apagar "Que me encuentren por mi usuario"
-- (0123). Es el único camino para escribirlo: `players` no tiene grants de
-- escritura para `authenticated` (0118).
--
-- El jugador sale de `auth.uid()`, nunca de un parámetro, así que nadie
-- cambia el de otro. Devuelve cómo quedó.
create or replace function public.set_my_discoverable(p_discoverable boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Tenés que iniciar sesión.';
  end if;
  if p_discoverable is null then
    raise exception 'Falta si te pueden encontrar.';
  end if;

  update public.players
     set discoverable = p_discoverable
   where user_id = v_uid;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'Tu cuenta no tiene un jugador.';
  end if;

  return p_discoverable;
end;
$$;

revoke execute on function public.set_my_discoverable(boolean) from public, anon;
grant  execute on function public.set_my_discoverable(boolean) to authenticated;
