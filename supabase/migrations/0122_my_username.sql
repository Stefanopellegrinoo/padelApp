-- amigos-faciles, S7 ─────────────────────────────────────────────────────────
--
-- `my_username`: tu @usuario, o `null` si todavía no lo elegiste. Es lo que
-- mira el middleware para mandarte una sola vez a `/elegir-usuario`.
-- `players` no se lee directo (0103), así que va por acá, desde `auth.uid()`.
create or replace function public.my_username()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select username from public.players where user_id = (select auth.uid())
$$;

revoke execute on function public.my_username() from public, anon;
grant  execute on function public.my_username() to authenticated;
