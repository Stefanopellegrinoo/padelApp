-- ── close_matchday cierra una fecha por ranking (bowling, S4) ───────────────
-- Restatement de la ÚLTIMA versión (`0067_close_matchday_regular_guard.sql`,
-- verificada contra `pg_proc.prosrc` antes de copiarla, y la única función de
-- ese archivo). Para todo `formato` que no sea `RANKING` el cuerpo es el de
-- 0067 byte a byte: el único cambio en ese camino es que el guard de "puntos
-- para alguien que no jugó" pasa a estar adentro de un `if`, con la MISMA
-- consulta sobre `pairs`.
--
-- Una fecha `RANKING` no tiene parejas ni partidos: quién jugó lo dice
-- `attendances` (PLAYING) y lo que hizo, `matchday_scores` (0109). Para ella:
-- 1. "Hay puntos para alguien que no jugó" mira a los presentes, no a `pairs`.
-- 2. Cada presente tiene que tener su total ("Faltan pinos por cargar.").
-- 3. Los puntos tienen que salir de los pinos: exactamente un award por
--    presente, con el puesto de `rank()` —los empatados comparten el puesto y
--    el siguiente salta los que ocuparon (S4)— y los puntos de ESE puesto en
--    la config de la disciplina. Lo calcula `computeRankingAwards`
--    (core/ranking-fecha.ts); acá se VERIFICA, porque la función la puede
--    llamar cualquier admin por RPC con el payload que quiera.
-- El resto (desglose que suma, inserts, trinquete de la disciplina) es el
-- mismo camino para todos.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_season         uuid;
  v_discipline     uuid;
  v_status         text;
  v_kind           text;
  v_formato        jsonb;
  v_has_masters    boolean;
  v_regular        int;
  v_closed_regular int;
  v_config         jsonb;
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

  -- Sin esto, un `p_awards` en null cierra la fecha sin repartir un solo punto
  -- y sin decir nada: `jsonb_array_length(null)` da null, el `if` de abajo no
  -- dispara, y `jsonb_array_elements(null)` no devuelve filas. La función la
  -- puede llamar cualquier admin por RPC, así que el payload se valida.
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
    raise exception 'La lista de puntos llegó mal formada.';
  end if;

  -- El payload lo arma quien llama, y `p_awards` puede nombrar a cualquiera:
  -- sin este control, un admin paga puntos a un jugador que ni jugó esta
  -- fecha (o a cualquier uuid inventado). Sólo entra quien está en alguna
  -- pareja de la fecha que se está cerrando. `not exists` correlacionado,
  -- no `not in` sobre un `union`: ver comentario de cabecera de 0047.
  if v_formato ->> 'kind' = 'RANKING' then
    -- En una fecha por ranking juega quien está presente: no hay parejas.
    if exists (
      select 1
        from jsonb_array_elements(p_awards) as award
       where not exists (
         select 1
           from public.attendances a
          where a.matchday_id = p_matchday
            and a.status = 'PLAYING'
            and a.entry_id = (award ->> 'entryId')::uuid
       )
    ) then
      raise exception 'Hay puntos para alguien que no jugó esta fecha.';
    end if;
  elsif exists (
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

  -- El Masters no paga puntos: define al campeón del año (spec 2.7). Se cierra
  -- con la lista vacía y el campeón se deriva de los partidos, como todo.
  if v_kind = 'MASTERS' and jsonb_array_length(p_awards) > 0 then
    raise exception 'El Masters no reparte puntos.';
  end if;

  -- La fecha por ranking (S4): cada presente con su total, y los puntos que
  -- salen de esos totales y de ningún otro lado.
  if v_formato ->> 'kind' = 'RANKING' then
    if exists (
      select 1
        from public.attendances a
       where a.matchday_id = p_matchday
         and a.status = 'PLAYING'
         and not exists (
           select 1 from public.matchday_scores s
            where s.matchday_id = p_matchday and s.entry_id = a.entry_id
         )
    ) then
      raise exception 'Faltan pinos por cargar.';
    end if;

    select config into v_config from public.disciplines where id = v_discipline;

    -- Un award por presente (los dos conteos iguales, más "todo award es de un
    -- presente" de arriba y el `unique (matchday_id, entry_id)` de `awards`,
    -- hacen la biyección), con el puesto de `rank()` y los puntos de ese puesto.
    -- `->> (pos - 1)`: `points` es un array jsonb 0-based; un puesto sin valor
    -- da null, y `is distinct from` lo rechaza.
    if jsonb_array_length(p_awards) <> (
         select count(*) from public.attendances a
          where a.matchday_id = p_matchday and a.status = 'PLAYING'
       )
       or exists (
         select 1
           from jsonb_array_elements(p_awards) as award
           join (
             select s.entry_id, rank() over (order by s.score desc)::int as pos
               from public.matchday_scores s
               join public.attendances a
                 on a.matchday_id = s.matchday_id and a.entry_id = s.entry_id and a.status = 'PLAYING'
              where s.matchday_id = p_matchday
           ) as ranked on ranked.entry_id = (award ->> 'entryId')::uuid
          where (award ->> 'position')::int is distinct from ranked.pos
             or (award ->> 'points')::int is distinct from (v_config -> 'points' ->> (ranked.pos - 1))::int
       )
    then
      raise exception 'Los puestos o los puntos no salen de los pinos cargados.';
    end if;
  end if;

  if exists (
    select 1
      from public.matches m
     where m.matchday_id = p_matchday
       and not exists (select 1 from public.match_sets s where s.match_id = m.id)
       -- La rendija (C31, ver comentario de cabecera de 0044): TERCER_PUESTO
       -- queda afuera de este chequeo SÓLO si la fecha sigue siendo la llave
       -- que lo generó (`formato.kind = 'GROUPS_KNOCKOUT'`). Con `ROUND_ROBIN`
       -- —incluida una fecha que LLEGÓ ahí después de tener una llave— no
       -- hay excepción: cualquier otra fase, y siempre en el pádel, sigue
       -- exigiendo resultado como hoy.
       and not (m.fase = 'TERCER_PUESTO' and v_formato ->> 'kind' = 'GROUPS_KNOCKOUT')
  ) then
    raise exception 'Faltan resultados por cargar.';
  end if;

  -- REQ-D10-1 (design #3801, decisión #15): el desglose de cada award tiene
  -- que sumar el total, o el histórico miente desde el día uno. Cruza dos
  -- "tablas" (el total de `award` y la suma de sus `lines`), así que no hay
  -- forma declarativa (CHECK de una sola fila) de expresarlo -- va acá, el
  -- único escritor de `awards`/`award_lines`.
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

  -- `season_id` no está en el bloque original del plan: la tabla lo exige
  -- (FK compuesta a `entries` y a `matchdays`) desde que el esquema se
  -- amplió después de escribirlo. Sin él, todo insert de awards falla.
  insert into public.awards (matchday_id, entry_id, season_id, position, points)
  select p_matchday,
         (award ->> 'entryId')::uuid,
         v_season,
         (award ->> 'position')::int,
         (award ->> 'points')::int
    from jsonb_array_elements(p_awards) as award;

  -- REQ-D10-1: una fila por línea del desglose, con el `ordinal` que le dio
  -- `with ordinality` (1-based) corrido a 0-based -- coherente con el
  -- `check (ordinal >= 0)` de la tabla.
  insert into public.award_lines (matchday_id, entry_id, ordinal, reason, points)
  select p_matchday, (award ->> 'entryId')::uuid, (line.ord - 1)::int,
         line.value ->> 'reason', (line.value ->> 'points')::int
    from jsonb_array_elements(p_awards) as award,
         lateral jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) with ordinality as line(value, ord);

  update public.matchdays set status = 'CLOSED', closed_at = now() where id = p_matchday;

  -- El año se termina cuando se cierra el Masters, y en ningún otro momento
  -- salvo el caso de abajo (C34, decisión #4027): una disciplina sin Masters
  -- termina con su última fecha REGULAR. `seasons.status` ya no se toca en
  -- ninguna de las dos ramas.
  if v_kind = 'MASTERS' then
    update public.disciplines set status = 'FINISHED' where id = v_discipline;
  elsif v_kind = 'REGULAR' then
    select has_masters, (config ->> 'regularMatchdays')::int
      into v_has_masters, v_regular
      from public.disciplines where id = v_discipline;

    -- S97: el guard que `0049` perdió al mudar la lectura de `seasons` a
    -- `disciplines`. Sin él, un `config` sin `regularMatchdays` deja
    -- `v_regular` en NULL y el `if v_closed_regular >= v_regular` de abajo
    -- evalúa NULL -> falso: la disciplina NO TERMINA NUNCA, sin un error.
    -- Sólo se chequea en esta rama porque es la única que lo LEE.
    if v_regular is null then
      raise exception 'La disciplina no tiene definida la cantidad de fechas.';
    end if;

    -- El mismo trinquete, a nivel disciplina: es SU Masters el que terminó.
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
