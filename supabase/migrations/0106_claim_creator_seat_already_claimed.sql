-- security-hardening, S8 (parte 3) ───────────────────────────────────────────
--
-- `claim_creator_seat` (0102) reemplaza a `claim_seat` para que el admin reclame
-- su asiento sin token (0104 revocó la lectura de `invite_token`). Pero la
-- versión de 0102 no traía el guard de `claim_seat` "ya tenés un lugar en este
-- torneo": sin él, un admin podía reclamar DOS asientos seguidos del mismo
-- torneo. Acá se lo devuelve, idéntico al de `claim_seat`, para que
-- `claimOwnSeat` (`db/entries.ts`, la acción "tomar asiento") siga rechazando
-- el segundo lugar.

create or replace function public.claim_creator_seat(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_season uuid;
begin
  select id into v_player from public.players where user_id = (select auth.uid());
  if v_player is null then
    raise exception 'Entrá con tu cuenta antes de reclamar un lugar.';
  end if;

  select season_id into v_season from public.entries where id = p_entry and kind = 'SQUAD';
  if v_season is null then
    raise exception 'No se pudo reclamar el lugar.';
  end if;

  if exists (select 1 from public.entries where season_id = v_season and player_id = v_player) then
    raise exception 'Ya tenés un lugar en este torneo.';
  end if;

  update public.entries e
     set player_id = v_player
   where e.id = p_entry
     and e.kind = 'SQUAD'
     and e.player_id is null
     and public.is_season_admin(e.season_id);
  if not found then
    raise exception 'No se pudo reclamar el lugar.';
  end if;
end;
$$;

revoke execute on function public.claim_creator_seat(uuid) from public, anon;
grant  execute on function public.claim_creator_seat(uuid) to authenticated;
