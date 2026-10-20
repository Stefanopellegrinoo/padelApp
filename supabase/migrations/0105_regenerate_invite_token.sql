-- security-hardening, S8 (parte 2) ───────────────────────────────────────────
--
-- `regenerate_invite_token`: el admin genera un token nuevo. El viejo deja de
-- existir —`claim_seat`/`season_invite` matchean por `invite_token`, así que un
-- link repartido antes de regenerar ya no reclama ningún asiento. Es la pieza
-- que faltaba: el link no vencía ni se podía cambiar.
--
-- El token nuevo sale de `gen_random_uuid()` (mismo formato que el default de
-- columna en 0001). Sólo el admin (`created_by`) puede regenerarlo.

create or replace function public.regenerate_invite_token(p_season uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  update public.seasons
     set invite_token = replace(gen_random_uuid()::text, '-', '')
   where id = p_season
     and created_by = (select auth.uid())
  returning invite_token into v_token;

  if not found then
    raise exception 'No se pudo regenerar el link: sólo puede hacerlo quien organiza.';
  end if;

  return v_token;
end;
$$;

revoke execute on function public.regenerate_invite_token(uuid) from public, anon;
grant  execute on function public.regenerate_invite_token(uuid) to authenticated;
