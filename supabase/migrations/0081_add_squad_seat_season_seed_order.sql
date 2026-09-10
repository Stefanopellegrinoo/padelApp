-- ── add_squad_seat también escribe season_seed_order (torneo-multi-
--    disciplina, tanda 1) ─────────────────────────────────────────────────
-- Restatement quirúrgico de la definición viva (0061_add_squad_seat_no_
-- entries_seed.sql), verificada contra `pg_proc.prosrc` antes de copiarla —
-- no contra el archivo, que es como se copia de la migración equivocada.
--
-- Cambia UNA sola cosa: después de crear el asiento en `entries`, un insert
-- más en `season_seed_order` (0080_season_seed_order.sql). Todo lo demás
-- —el guard de admin, el del nombre, el de `p_before`, el loop por
-- disciplina con su parking y su caso "no juega esta disciplina"— es byte a
-- byte lo que ya estaba.
--
-- **`p_before` corre la cola A LOS DOS NIVELES, temporada y disciplina.**
-- WU1 (tanda 3, round 2 review fix) corrige la premisa con la que había
-- nacido este archivo: acá abajo decía "no existe ningún flujo que deje
-- elegir 'antes de quién' a nivel TEMPORADA" — falso. `ajustes/plantel.tsx`
-- ofrece ese selector ("Posición" → "Antes de {seat.name}") desde Ajustes ›
-- Plantel, que es season-level (la lista que dibuja sale de
-- `seasonSquadMembersOf`, que desde esta misma PR lee `season_seed_order`) —
-- medido: agregar "antes de Juan" no movía nada en esa pantalla porque el
-- `p_before` de acá sólo corría `discipline_entries`. El corrimiento usa
-- `shift_season_seeds_up` (0080_season_seed_order.sql, agregada ahí y no
-- acá: `db/migrations.unit.test.ts` exige una función por restatement desde
-- 0026, y 0080 es la única migración de esta tanda que todavía no tenía
-- ninguna) — mismo parking de dos pasadas que `shift_seeds_up` (0023) pero
-- sobre `season_seed_order`.
--
-- La firma NO cambia, así que va `create or replace` y los grants
-- sobreviven (mismo motivo que 0061 documentó sobre el `drop function` de
-- 0023, que ahí SÍ cambiaba la firma).
create or replace function public.add_squad_seat(
  p_season uuid, p_name text, p_before uuid default null,
  p_disciplines uuid[] default null   -- null = todas las de la temporada
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_at int; v_disc uuid; v_season_at int;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede agregar un asiento.';
  end if;
  if coalesce(p_name, '') !~ '\S' then
    raise exception 'El asiento necesita un nombre.';
  end if;

  -- Guard que 0013 ya tenía sobre `entries` y que el corrimiento a
  -- `discipline_entries` no puede perder: un `p_before` que no es NINGÚN
  -- asiento SQUAD de esta temporada se rechaza ENTERO, sin agregar nada — no
  -- alcanza con "no está en la disciplina que estoy iterando" (eso, más
  -- abajo, es el caso legítimo "no juega esta disciplina" y va al final ahí,
  -- no en todas).
  if p_before is not null then
    perform 1 from public.entries
     where id = p_before and season_id = p_season and kind = 'SQUAD';
    if not found then
      raise exception 'Ese jugador no está en el plantel.';
    end if;
  end if;

  -- C37: sin `seed_position`. El dual-write tail-only que 0023 dejó acá
  -- (`v_tail`, `max + 1`) escribía una réplica degradada del orden que ya
  -- nadie leía, y el CHECK `entries_seed_shape` del contract la va a
  -- prohibir. El orden REAL de este asiento se escribe en el loop de abajo,
  -- una fila de `discipline_entries` por disciplina — que es donde `p_before`
  -- posiciona de verdad desde PR 7.
  insert into public.entries (season_id, kind, display_name)
  values (p_season, 'SQUAD', trim(p_name)) returning id into v_id;

  -- season_seed_order (0080): WU1 -- `p_before` corre la cola acá también,
  -- con `shift_season_seeds_up` (arriba). El caso "no tiene fila en
  -- season_seed_order" no debería darse -- `p_before` ya se validó arriba
  -- como un SQUAD real de esta temporada, y todo SQUAD tiene exactamente una
  -- fila acá (a diferencia de `discipline_entries`, donde "no juega esta
  -- disciplina" sí es legítimo) -- pero se cubre igual que el loop de abajo,
  -- al final, en vez de asumir `not null`.
  if p_before is null then
    select coalesce(max(seed_position), -1) + 1 into v_season_at
      from public.season_seed_order where season_id = p_season;
  else
    select seed_position into v_season_at from public.season_seed_order
     where season_id = p_season and entry_id = p_before for update;
    if v_season_at is null then
      select coalesce(max(seed_position), -1) + 1 into v_season_at
        from public.season_seed_order where season_id = p_season;
    else
      perform public.shift_season_seeds_up(p_season, v_season_at);
    end if;
  end if;
  insert into public.season_seed_order (season_id, entry_id, seed_position)
  values (p_season, v_id, v_season_at);

  for v_disc in
    select d.id from public.disciplines d
     where d.season_id = p_season and (p_disciplines is null or d.id = any(p_disciplines))
     order by d.position, d.created_at
  loop
    if p_before is null then
      select coalesce(max(seed_position), -1) + 1 into v_at
        from public.discipline_entries where discipline_id = v_disc;
    else
      select seed_position into v_at from public.discipline_entries
       where discipline_id = v_disc and entry_id = p_before for update;
      if v_at is null then
        -- El asiento de referencia no juega ESTA disciplina: va al final acá
        -- y en su lugar en las que sí. No hay lugar que respetar.
        select coalesce(max(seed_position), -1) + 1 into v_at
          from public.discipline_entries where discipline_id = v_disc;
      else
        perform public.shift_seeds_up(v_disc, v_at);
      end if;
    end if;
    insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
    values (v_disc, v_id, p_season, v_at);
  end loop;
  return v_id;
end;
$$;
