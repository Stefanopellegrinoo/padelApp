-- security-hardening, S8 (parte 1) ───────────────────────────────────────────
--
-- `seasons_read` (0002) es `for select using (is_participant(id))`, y el grant
-- de columnas de 0002 deja que CUALQUIER participante lea `invite_token` —la
-- llave del link de invitación— y la comparta. El token sólo lo necesita el
-- admin (para el botón "Copiar") y las funciones security definer (`claim_seat`,
-- `season_invite`) que ya lo leen por su cuenta.
--
-- El fix: revocar la lectura a `authenticated`/`anon` y devolver SÓLO las
-- columnas que la app lee —`invite_token` queda afuera. Se revoca a nivel tabla
-- y se re-otorga por columna (un `revoke select (invite_token)` NO vence al
-- grant a nivel tabla; mismo patrón que `players` en 0002). El token sólo lo
-- devuelve `season_invite_token` (abajo), y sólo al admin.
--
-- No-destructivo y reversible (L5): sólo privilegios y una función nueva.

revoke select on public.seasons from authenticated, anon;
grant select (id, name, rules_text, rules_updated_at, created_by, created_at, players_can_score)
  on public.seasons to authenticated;

create or replace function public.season_invite_token(p_season uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.invite_token
    from public.seasons s
   where s.id = p_season
     and s.created_by = (select auth.uid())
$$;

revoke execute on function public.season_invite_token(uuid) from public, anon;
grant  execute on function public.season_invite_token(uuid) to authenticated;
