-- C34 (verify-report-pre-contract #4026) + decisión #4027, 2 de 3 ─────────
--
-- Mitad de CIERRE: una disciplina sin Masters (`has_masters=false`, ver
-- `0050`) termina cuando se cierra su última fecha REGULAR
-- (`config.regularMatchdays`, la misma fuente que W87/0049 ya usa) -- sin
-- Masters de por medio. `0052` es el trinquete simétrico en
-- `reopen_matchday`.
--
-- Restatement de la ÚLTIMA versión (0047_award_lines.sql, verificado con
-- `rg '^create( or replace)? function|^drop function'` -> una sola función
-- en ese archivo). Tiene la rendija del TERCER_PUESTO de 0044 y el guard de
-- suma + insert de `award_lines` de 0047 -- los dos BYTE A BYTE intactos. El
-- único agregado es el `elsif v_kind = 'REGULAR'`, con el mismo criterio de
-- conteo (`v_closed_regular >= v_regular`) que ya usa `create_masters` para
-- decidir si el Masters se puede armar -- acá decide si YA NO hace falta.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season         uuid;
  v_discipline     uuid;
  v_status         text;
  v_kind           text;
  v_formato        jsonb;
  v_has_masters    boolean;
  v_regular        int;
  v_closed_regular int;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select discipline_id, status, kind, formato into v_discipline, v_status, v_kind, v_formato
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'OPEN' then
    raise exception 'Sólo se cierra una fecha que está en juego.';
  end if;

  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
    raise exception 'La lista de puntos llegó mal formada.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where not exists (
       select 1
         from public.pairs p
        where p.matchday_id = p_matchday
          and (award ->> 'entryId')::uuid in (p.entry_a, p.entry_b)
     )
  ) then
    raise exception 'Hay puntos para alguien que no jugó esta fecha.';
  end if;

  if v_kind = 'MASTERS' and jsonb_array_length(p_awards) > 0 then
    raise exception 'El Masters no reparte puntos.';
  end if;

  if exists (
    select 1
      from public.matches m
     where m.matchday_id = p_matchday
       and not exists (select 1 from public.match_sets s where s.match_id = m.id)
       and not (m.fase = 'TERCER_PUESTO' and v_formato ->> 'kind' = 'GROUPS_KNOCKOUT')
  ) then
    raise exception 'Faltan resultados por cargar.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where (award ->> 'points')::int is distinct from (
       select coalesce(sum((line ->> 'points')::int), 0)
         from jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) as line
     )
  ) then
    raise exception 'El desglose no suma el total del premio.';
  end if;

  insert into public.awards (matchday_id, entry_id, season_id, position, points)
  select p_matchday,
         (award ->> 'entryId')::uuid,
         v_season,
         (award ->> 'position')::int,
         (award ->> 'points')::int
    from jsonb_array_elements(p_awards) as award;

  insert into public.award_lines (matchday_id, entry_id, ordinal, reason, points)
  select p_matchday, (award ->> 'entryId')::uuid, (line.ord - 1)::int,
         line.value ->> 'reason', (line.value ->> 'points')::int
    from jsonb_array_elements(p_awards) as award,
         lateral jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) with ordinality as line(value, ord);

  update public.matchdays set status = 'CLOSED', closed_at = now() where id = p_matchday;

  -- El año se termina cuando se cierra el Masters, y en ningún otro momento
  -- salvo el caso nuevo de abajo (C34, decisión #4027): una disciplina sin
  -- Masters no tiene otro cierre posible, así que termina con su última
  -- fecha REGULAR.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'FINISHED' where id = v_season;
    update public.disciplines set status = 'FINISHED' where id = v_discipline;
  elsif v_kind = 'REGULAR' then
    select has_masters, (config ->> 'regularMatchdays')::int
      into v_has_masters, v_regular
      from public.disciplines where id = v_discipline;

    if not v_has_masters then
      select count(*) into v_closed_regular
        from public.matchdays
       where discipline_id = v_discipline and kind = 'REGULAR' and status = 'CLOSED';

      if v_closed_regular >= v_regular then
        update public.disciplines set status = 'FINISHED' where id = v_discipline;
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function public.close_matchday(uuid, jsonb) from public, anon;
grant  execute on function public.close_matchday(uuid, jsonb) to authenticated;
