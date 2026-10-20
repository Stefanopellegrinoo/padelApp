-- security-hardening, S1 ─────────────────────────────────────────────────────
--
-- `entries_write` (0002) es `for all` con `is_season_admin(season_id)`, y el
-- grant de columnas de 0002 le da a `authenticated` INSERT/UPDATE sobre TODAS
-- las columnas. Un admin de su propia temporada puede entonces escribir
-- `player_id = <víctima>` por PostgREST directo —sin pasar por `claim_seat`—
-- y anotar a otro jugador en su torneo, rompiéndole "Mis torneos".
--
-- El fix: revocar el INSERT/UPDATE directo y devolver SÓLO las columnas que la
-- app escribe a mano. `player_id` queda AFUERA del grant: el único camino para
-- VINCULAR un jugador a un asiento es `claim_seat` (security definer), y para
-- soltarlo, la función `unlink_seat` nueva acá abajo. `add_squad_seat` (0081) y
-- `promote_guest` (0082) ya son security definer y no tocan `player_id`.
--
-- Qué queda directo: INSERT de asientos (createSeason squad + addGuest guest)
-- sin `player_id`, y UPDATE de `display_name` (renameSeat/nameGuest). Todo lo
-- demás de la fila (kind, seed_position, matchday_id, player_id) sólo cambia por
-- función.
--
-- No-destructivo y reversible (L5): sólo privilegios y dos funciones nuevas.

revoke insert, update on public.entries from authenticated, anon;

grant insert (season_id, display_name, kind, seed_position, matchday_id)
  on public.entries to authenticated;
grant update (display_name) on public.entries to authenticated;

-- ── unlink_seat: soltar un asiento (player_id = null) ────────────────────────
-- Antes lo hacía `db/entries.ts: unlinkSeat` con un update directo. Con el
-- revoke de arriba eso ya no puede escribir `player_id`, así que el soltado
-- pasa por esta función security definer, igual que el reclamo pasa por
-- `claim_seat`. Sólo el admin de la temporada, y sólo un asiento SQUAD.
create or replace function public.unlink_seat(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.entries e
     set player_id = null
   where e.id = p_entry
     and e.kind = 'SQUAD'
     and public.is_season_admin(e.season_id);
  if not found then
    raise exception 'No se pudo desvincular el asiento: sólo puede hacerlo quien organiza.';
  end if;
end;
$$;

revoke execute on function public.unlink_seat(uuid) from public, anon;
grant  execute on function public.unlink_seat(uuid) to authenticated;
