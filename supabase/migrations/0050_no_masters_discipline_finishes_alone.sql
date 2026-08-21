-- C34 (verify-report-pre-contract #4026) + decisión #4027 ────────────────
--
-- Una disciplina de a uno (`pair_size=1`) crea su Masters sin que nada la
-- valide (`create_masters`), y ese Masters rechaza para siempre armarse
-- (`generateMastersPairs`, `db/matchday.ts:985`, "El Masters se juega de a
-- parejas: una disciplina de a uno no lo arma."). `close_matchday` del
-- Masters es lo ÚNICO que pone `disciplines.status = 'FINISHED'`: la
-- disciplina queda trabada y la temporada no se puede terminar NUNCA.
--
-- Decisión de Stefano (#4027): `disciplines.has_masters` (0015:21, default
-- `true`, CERO lectores de producción hasta acá) se empieza a LEER. Una
-- disciplina puede declarar que no juega Masters -- el caso natural es la de
-- a uno -- y en ese caso termina cuando se cierra su última fecha REGULAR
-- (`config.regularMatchdays`, la misma fuente que W87/0049 ya usa), sin
-- Masters de por medio. Esta migración no decide QUIÉN pone
-- `has_masters=false` -- eso es una decisión de producto aparte (pantalla o
-- default por `pair_size`), explícitamente fuera de esta tanda.
--
-- Tres funciones tocadas, restateadas cada una desde su ÚLTIMA versión
-- (verificado con `rg '^create( or replace)? function|^drop function'` antes
-- de copiar cada una -- 0019 define TRES funciones, así que de ahí sólo se
-- copia el cuerpo de `reopen_matchday`, no el archivo entero):
--
-- 1. `create_masters` (restatement de 0049, que define una sola función):
--    guard nuevo, ANTES de contar fechas cerradas -- una disciplina sin
--    Masters lo rechaza siempre, sin importar cuánto lleva jugado.
-- 2. `close_matchday` (restatement de 0047, una sola función; tiene la
--    rendija del TERCER_PUESTO de 0044 y el guard de suma + insert de
--    `award_lines` de 0047 -- los dos BYTE A BYTE intactos, el único
--    agregado es el `elsif v_kind = 'REGULAR'` de más abajo): cuando la
--    fecha que cierra es REGULAR y es la ÚLTIMA de una disciplina sin
--    Masters, la disciplina pasa a FINISHED ahí mismo -- mismo criterio de
--    conteo (`v_closed_regular >= v_regular`) que ya usa `create_masters`.
-- 3. `reopen_matchday` (cuerpo de 0019:173-239, la única versión que existe):
--    simétrico -- reabrir esa misma fecha revierte la disciplina a ACTIVE.
--    Sin esto, reabrir la última fecha regular de una disciplina sin Masters
--    la dejaría FINISHED con su fecha de vuelta abierta -- el mismo trinquete
--    roto que el Masters ya tiene resuelto para su propio caso.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline  uuid;
  v_pair_size   int;
  v_allows_draw boolean;
  v_has_masters boolean;
  v_regular     int;
  v_closed      int;
  v_number      int;
  v_new         uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select id, pair_size, allows_draw, has_masters, (config ->> 'regularMatchdays')::int
    into v_discipline, v_pair_size, v_allows_draw, v_has_masters, v_regular
    from public.disciplines
   where season_id = p_season
   order by position, created_at
   limit 1;
  if v_discipline is null then
    raise exception 'La temporada no tiene disciplina.';
  end if;

  if not v_has_masters then
    raise exception 'Esta disciplina no juega Masters: termina con su última fecha regular.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where discipline_id = v_discipline and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where discipline_id = v_discipline;

  insert into public.matchdays (season_id, discipline_id, number, kind, played_on, pair_size, allows_draw)
  values (p_season, v_discipline, v_number, 'MASTERS', p_played_on, v_pair_size, v_allows_draw)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;

-- ── close_matchday (restatement de 0047_award_lines.sql) ───────────────────
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
  -- fecha REGULAR. Mismo criterio de conteo que `create_masters` usa para
  -- decidir si ya se puede armar el Masters -- acá decide si YA NO hace
  -- falta.
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

-- ── reopen_matchday (restatement de 0019_discipline_status_moves.sql:173-239,
-- la única versión que existe -- ese archivo define TRES funciones y este
-- restatement copia sólo el cuerpo de ÉSTA, no el archivo entero) ─────────
create or replace function public.reopen_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_number     int;
  v_status     text;
  v_kind       text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede reabrir una fecha.';
  end if;

  select discipline_id, number, status, kind into v_discipline, v_number, v_status, v_kind
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'CLOSED' then
    raise exception 'Esta fecha no está cerrada.';
  end if;

  delete from public.matchdays m
   where m.discipline_id = v_discipline
     and m.id <> p_matchday
     and m.status = 'DRAFT'
     and not exists (select 1 from public.pairs       x where x.matchday_id = m.id)
     and not exists (select 1 from public.attendances x where x.matchday_id = m.id)
     and not exists (select 1 from public.pair_locks  x where x.matchday_id = m.id)
     and not exists (select 1 from public.entries     x where x.matchday_id = m.id);

  if exists (
    select 1 from public.matchdays
     where discipline_id = v_discipline and status <> 'CLOSED' and id <> p_matchday
  ) then
    raise exception 'La fecha siguiente ya tiene datos cargados. Borrala vos antes de reabrir ésta.';
  end if;
  if exists (
    select 1 from public.matchdays
     where discipline_id = v_discipline and number > v_number and status = 'CLOSED'
  ) then
    raise exception 'Sólo se reabre la última fecha cerrada: las parejas de las que siguen salieron de esta tabla.';
  end if;

  delete from public.awards where matchday_id = p_matchday;
  update public.matchdays set status = 'OPEN', closed_at = null where id = p_matchday;

  if v_kind = 'MASTERS' then
    update public.seasons set status = 'ACTIVE' where id = v_season;
    update public.disciplines set status = 'ACTIVE' where id = v_discipline;
  elsif v_kind = 'REGULAR' then
    -- Simétrico al `elsif` nuevo de `close_matchday`: si esta fecha fue la
    -- que dejó a una disciplina sin Masters en FINISHED, reabrirla la vuelve
    -- a ACTIVE. El guard `status = 'FINISHED'` alcanza -- por construcción
    -- sólo la ÚLTIMA fecha regular pudo haber marcado FINISHED, y "sólo se
    -- reabre la última fecha cerrada" ya está garantizado arriba -- así que
    -- no hace falta releer `has_masters` para saber que aplica.
    update public.disciplines set status = 'ACTIVE' where id = v_discipline and status = 'FINISHED';
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;
