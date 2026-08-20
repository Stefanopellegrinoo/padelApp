-- ── close_matchday (restatement de 0030_close_matchday_award_guard.sql:36-129) ─
-- La ÚLTIMA restatement viva es 0030 (0005 → 0019 → 0030, verificado con
-- `rg 'close_matchday' supabase/migrations/` antes de escribir este archivo:
-- ninguna posterior a 0030 la toca). Copiada de ahí, no de una versión vieja.
--
-- Rendija de UNA sola fase (decisión #3979, `decisions/guard-close-matchday-
-- tercer-puesto`): el partido de TERCER_PUESTO puede quedar SIN JUGAR y la
-- fecha igual cierra -- el 3º/4º sale de la tabla de grupos combinada
-- (`knockoutPositions`, `core/knockout.ts`, vía `standingsFromBracket`,
-- `db/matchday.ts`). El partido vacío se queda en `matches` como registro
-- visible de que no se jugó -- no se borra, no se inventa un resultado.
--
-- Por qué aflojar acá un guard de producción es aceptable: el riesgo para
-- el pádel es CERO POR CONSTRUCCIÓN, no por confianza. Una fecha
-- ROUND_ROBIN nunca manda `fase` al armar (`roundRobinMatches`,
-- `db/matchday.ts`), así que TODOS sus partidos caen en el default
-- 'GRUPO' de `matches.fase` (`0039_match_phase.sql`) -- un partido de
-- TERCER_PUESTO no existe ni puede existir en una fecha de pádel. La
-- rendija sólo se abre para una fase que el camino de pádel jamás produce.
--
-- El resto de la función (0030:36-129) no cambia una línea.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_status     text;
  v_kind       text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select discipline_id, status, kind into v_discipline, v_status, v_kind
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
  --No `not in` sobre un `union`: ver comentario de cabecera.
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

  -- El Masters no paga puntos: define al campeón del año (spec 2.7). Se cierra
  -- con la lista vacía y el campeón se deriva de los partidos, como todo.
  if v_kind = 'MASTERS' and jsonb_array_length(p_awards) > 0 then
    raise exception 'El Masters no reparte puntos.';
  end if;

  if exists (
    select 1
      from public.matches m
     where m.matchday_id = p_matchday
       and not exists (select 1 from public.match_sets s where s.match_id = m.id)
       -- La rendija (ver comentario de cabecera): TERCER_PUESTO queda afuera
       -- de este chequeo aunque no tenga resultado. Cualquier otra fase --
       -- GRUPO, OCTAVOS, CUARTOS, SEMI, FINAL, y siempre en el pádel -- sigue
       -- exigiendo resultado como hoy.
       and m.fase <> 'TERCER_PUESTO'
  ) then
    raise exception 'Faltan resultados por cargar.';
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

  update public.matchdays set status = 'CLOSED', closed_at = now() where id = p_matchday;

  -- El año se termina cuando se cierra el Masters, y en ningún otro momento.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'FINISHED' where id = v_season;

    -- El mismo trinquete, a nivel disciplina: es SU Masters el que terminó.
    update public.disciplines set status = 'FINISHED' where id = v_discipline;
  end if;
end;
$$;

revoke execute on function public.close_matchday(uuid, jsonb) from public, anon;
grant  execute on function public.close_matchday(uuid, jsonb) to authenticated;
