-- amigos-faciles, S7 ─────────────────────────────────────────────────────────
--
-- `username_available`: si un @usuario exacto está libre, para el "está
-- libre" / "ya está en uso" del registro y de la pantalla única.
--
-- **Va también para `anon`**, y es la única de este feature: el registro es
-- anónimo y tiene que decirlo antes de crear la cuenta. Lo que revela es lo
-- mismo que revela cualquier formulario de alta: si UN @usuario exacto existe.
-- No lista, no busca por prefijo y no dice de quién es (ni jugador ni
-- cuenta). El buscador de S8 es otra función, sólo con sesión.
--
-- Un formato inválido no está disponible: así la respuesta es siempre "lo
-- podés usar" o no, y una cadena rara no llega a la consulta.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(trim(p_username)) ~ '^[a-z0-9][a-z0-9._]{2,19}$'
     and not exists (
       select 1 from public.players where username = lower(trim(p_username))
     )
$$;

revoke execute on function public.username_available(text) from public;
grant  execute on function public.username_available(text) to anon, authenticated;
