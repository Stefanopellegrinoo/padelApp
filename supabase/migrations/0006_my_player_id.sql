-- La pestaña "Mías" de Estadísticas necesita saber cuál entry es la del
-- caller. `players.user_id` no tiene SELECT otorgado a `authenticated`
-- (0002_rls.sql) — a propósito, para no dejar correlacionar auth.uid() con
-- player por una consulta directa — así que sólo una función security
-- definer puede resolver el mapeo, igual que ya hace `claim_seat` inline.
create or replace function public.my_player_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.players where user_id = (select auth.uid())
$$;

revoke execute on function public.my_player_id() from public, anon;
grant  execute on function public.my_player_id() to authenticated;
