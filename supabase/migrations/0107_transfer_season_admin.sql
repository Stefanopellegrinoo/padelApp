-- borrar-cuenta, S1 (odd/tasks/borrar-cuenta.md) ─────────────────────────
--
-- App Store exige poder borrar la cuenta desde la app. Se borra "desvinculando":
-- el login (`auth.users`) y las amistades se van; el `players` queda, sin
-- `user_id`, igual que un jugador que el admin tipeó y nunca reclamó. Así las
-- tablas, los resultados y los partidos casuales de los demás no cambian.
--
-- Cada torneo tiene un único admin (`seasons.created_by`, RESTRICT), así que
-- antes hace falta poder pasarle la administración a otro.

-- ── transfer_season_admin ───────────────────────────────────────────────────
-- El admin le pasa el torneo al jugador de un asiento del plantel que tenga
-- cuenta. Primero se verifica que quien llama sea el admin: a un no-admin no se
-- le dice nada sobre el asiento.
create or replace function public.transfer_season_admin(p_season uuid, p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not exists (
    select 1 from public.seasons where id = p_season and created_by = (select auth.uid())
  ) then
    raise exception 'Sólo quien organiza puede pasar la administración.';
  end if;

  select p.user_id into v_user
    from public.entries e
    join public.players p on p.id = e.player_id
   where e.id = p_entry
     and e.season_id = p_season
     and e.kind = 'SQUAD';

  if v_user is null then
    raise exception 'Ese jugador no tiene cuenta: tiene que unirse con el link antes de poder organizar.';
  end if;
  if v_user = (select auth.uid()) then
    raise exception 'Ya sos quien organiza este torneo.';
  end if;

  update public.seasons set created_by = v_user where id = p_season;
end;
$$;

revoke execute on function public.transfer_season_admin(uuid, uuid) from public, anon;
grant  execute on function public.transfer_season_admin(uuid, uuid) to authenticated;
