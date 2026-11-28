-- amigos-faciles, S8 ─────────────────────────────────────────────────────────
--
-- `my_discoverable`: si te encuentran por tu @usuario (0123), para el
-- interruptor de tu perfil. `players` no se lee directo (0103), así que va
-- por acá, desde `auth.uid()`. `null` si tu cuenta no tiene jugador.
create or replace function public.my_discoverable()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select discoverable from public.players where user_id = (select auth.uid())
$$;

revoke execute on function public.my_discoverable() from public, anon;
grant  execute on function public.my_discoverable() to authenticated;
