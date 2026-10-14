-- El único camino de escritura del partido casual (tablas en 0072, RLS en
-- 0090, forma en 0091): cargar uno nuevo o editar uno existente, en UNA
-- transacción. Hace falta una RPC porque el partido son tres tablas: por
-- PostgREST serían tres requests, y cualquiera que fallara a la mitad dejaría
-- un partido de pádel sin sets a la vista, o un partido sin jugadores.
--
-- `security invoker`: la RPC no tiene más permisos que quien la llama. Toda
-- la seguridad sigue en la RLS (0090) -- en particular la puerta de amistad
-- §4.5 por jugador -- y en el trigger de forma (0091). Esto sólo agrupa.
--
-- Valida casi nada a propósito: el resultado lo valida `parseCasualResult`
-- (`db/friends.ts`) y la base sólo pone los CHECK de forma (0072). Ver ahí
-- qué NO chequea la base (sets vs. formato vs. ganador).
create function public.save_casual_match(
  p_id          uuid,
  p_sport       text,
  p_played_on   date,
  p_winner_side text,
  p_score_a     int,
  p_score_b     int,
  p_team_a      text,
  p_team_b      text,
  p_players     jsonb,
  p_sets        jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_me uuid := public.my_player_id();
  v_id uuid := p_id;
begin
  if v_id is null then
    -- Alta. El id se genera ACÁ y no con `returning`: un `insert ...
    -- returning` exige además pasar la política de SELECT sobre la fila
    -- nueva, y no hay por qué depender de eso para saber qué se insertó.
    v_id := gen_random_uuid();
    insert into public.casual_matches
      (id, sport, played_on, winner_side, score_a, score_b, team_a, team_b, created_by, updated_by)
    values
      (v_id, p_sport, p_played_on, p_winner_side, p_score_a, p_score_b, p_team_a, p_team_b, v_me, v_me);

    -- Cada fila pasa por `casual_match_players_insert` (0090): la puerta de
    -- amistad corre jugador por jugador.
    insert into public.casual_match_players (match_id, side, player_id, guest_name)
    select v_id, x.side, x.player_id, x.guest_name
      from jsonb_to_recordset(p_players) as x(side text, player_id uuid, guest_name text);
  else
    -- Edición. `p_players` se ignora: el plantel es fijo una vez cargado.
    -- `casual_matches_update` (0090) acota a los que jugaron; cero filas es
    -- "no existe o no es tuyo", y se dice en voz alta en vez de devolver un
    -- éxito que no escribió nada.
    update public.casual_matches
       set sport       = p_sport,
           played_on   = p_played_on,
           winner_side = p_winner_side,
           score_a     = p_score_a,
           score_b     = p_score_b,
           team_a      = p_team_a,
           team_b      = p_team_b,
           updated_by  = v_me
     where id = v_id;
    if not found then
      raise exception 'El partido no existe o no te corresponde.' using errcode = '42501';
    end if;
    -- Editar los sets es reemplazarlos -- en la misma transacción, así nunca
    -- queda un partido de pádel sin sets a la vista.
    delete from public.casual_match_sets where match_id = v_id;
  end if;

  -- DESPUÉS de los jugadores, y el orden importa: `casual_match_sets_insert`
  -- (0090) pide ser participante, y en un alta eso recién es cierto cuando
  -- la fila de quien carga ya está en `casual_match_players`.
  insert into public.casual_match_sets (match_id, set_number, games_a, games_b)
  select v_id, x.set_number, x.games_a, x.games_b
    from jsonb_to_recordset(p_sets) as x(set_number int, games_a int, games_b int);

  return v_id;
end;
$$;

revoke execute on function
  public.save_casual_match(uuid, text, date, text, int, int, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function
  public.save_casual_match(uuid, text, date, text, int, int, text, text, jsonb, jsonb)
  to authenticated;
