-- Lo que ve la pantalla de Unirse. security definer porque el que entra por el
-- link todavía no participa, así que las políticas de lectura no lo dejan ver
-- nada de esta temporada — que es justamente lo que viene a arreglar.
create or replace function public.season_invite(p_token text)
returns table (
  season_id    uuid,
  season_name  text,
  admin_name   text,
  squad_size   int,
  entry_id     uuid,
  display_name text,
  seed_position int,
  claimed      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.name,
         admin.display_name,
         (select count(*)::int from public.entries e2
           where e2.season_id = s.id and e2.kind = 'SQUAD'),
         e.id,
         e.display_name,
         e.seed_position,
         e.player_id is not null
    from public.seasons s
    join public.players admin on admin.user_id = s.created_by
    join public.entries e on e.season_id = s.id and e.kind = 'SQUAD'
   where s.invite_token = p_token
   order by e.seed_position
$$;

-- `from public, anon`, no `from anon` solo: Postgres otorga EXECUTE a PUBLIC en
-- toda función nueva, así que revocarle a anon deja intacto el grant heredado y
-- cualquiera sin cuenta se lleva el plantel entero con sólo tener el token.
revoke execute on function public.season_invite(text) from public, anon;
grant  execute on function public.season_invite(text) to authenticated;

-- El reclamo. Devuelve la temporada para poder redirigir.
create or replace function public.claim_seat(p_token text, p_entry uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_player uuid;
begin
  select id into v_season from public.seasons where invite_token = p_token;
  if v_season is null then
    raise exception 'El link de invitación no es válido.';
  end if;

  select id into v_player from public.players where user_id = (select auth.uid());
  if v_player is null then
    raise exception 'Entrá con tu cuenta antes de reclamar un lugar.';
  end if;

  if exists (select 1 from public.entries where season_id = v_season and player_id = v_player) then
    raise exception 'Ya tenés un lugar en este torneo.';
  end if;

  -- El `player_id is null` adentro del where es lo que hace atómico al
  -- reclamo: dos personas tocando el mismo asiento a la vez, y la segunda no
  -- encuentra fila.
  update public.entries
     set player_id = v_player
   where id = p_entry
     and season_id = v_season
     and kind = 'SQUAD'
     and player_id is null;

  if not found then
    raise exception 'Ese lugar ya lo reclamó otra persona.';
  end if;

  return v_season;
end;
$$;

revoke execute on function public.claim_seat(text, uuid) from public, anon;
grant  execute on function public.claim_seat(text, uuid) to authenticated;
