-- security-hardening, S1 (parte 2) ───────────────────────────────────────────
--
-- `claim_creator_seat`: el creador reclama SU asiento al crear la temporada.
-- `createSeason` inserta el plantel SIN `player_id` (0101 revocó el grant de esa
-- columna a `authenticated`) y reclama el asiento del creador por esta vía.
--
-- Mismo guard que `claim_seat` (la fila tiene que estar libre y el reclamante
-- ser el admin de la temporada), con una diferencia: acá el `player_id` sale del
-- `auth.uid()` del que llama, nunca de un parámetro — así no se puede usar para
-- anotar a un tercero. Es más estricto que `claim_seat` en un punto: además de
-- `player_id is null`, exige `is_season_admin`, así que nadie con el token puede
-- colarse a reclamar el asiento del creador.

create or replace function public.claim_creator_seat(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  select id into v_player from public.players where user_id = (select auth.uid());
  if v_player is null then
    raise exception 'Entrá con tu cuenta antes de reclamar un lugar.';
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
