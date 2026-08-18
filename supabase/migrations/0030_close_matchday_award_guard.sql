-- ── close_matchday (restatement de 0019_discipline_status_moves.sql:75-162) ─
-- C17 (verify-report ronda 10, sdd-apply de cierre sobre `pr14c-side-ddl`):
-- el guard de autorización de premios usaba
--   (award ->> 'entryId')::uuid not in (
--     select entry_a from pairs where matchday_id = p_matchday
--     union
--     select entry_b from pairs where matchday_id = p_matchday)
-- `0028` (REQ-D5-1) volvió `entry_b` nullable. Con una sola fila `pair_size=1`
-- legal en la fecha, el `union` trae una fila NULL, y `X NOT IN (conjunto con
-- NULL)` es NULL —nunca TRUE— para CUALQUIER `X`. El `where` no matchea, el
-- `exists` da false, y el `raise` queda inalcanzable para la fecha ENTERA:
-- quien organiza puede pagar puntos de campeonato a cualquier asiento del
-- plantel que no jugó, en silencio. Medido de punta a punta (verify-report
-- ronda 10, C17): control pádel rechaza con el mensaje de siempre; el mismo
-- premio sobre una fecha de a uno con dos singles legales quedaba ACEPTADO.
--
-- Se reemplaza `not in (select ... union select ...)` por un `not exists`
-- correlacionado que compara contra `(p.entry_a, p.entry_b)` fila por fila.
-- No es sólo el parche de este bug puntual: un `IN`/`NOT IN` de Postgres es
-- NULL en cuanto el conjunto de la derecha contiene un NULL sin matchear, así
-- que cualquier columna nullable futura que entre a este guard por la misma
-- puerta reproduciría C17. `NOT EXISTS` no tiene ese modo de falla —una fila
-- con `entry_b is null` simplemente no aporta un match por esa columna, sin
-- volver NULL el resultado de la fila entera— y es el mismo idioma que ya
-- usan `open_matchday`/`reopen_matchday` (0019) y `promote_guest` (0025) para
-- lo mismo. El resto de la función (0019:75-162) no cambia una línea.
--
-- N25 (verify-report ronda 11): la forma nueva tiene un segundo efecto, no
-- documentado hasta acá. Con `NOT IN`, un premio sin `entryId` o con
-- `entryId: null` daba `NULL not in (…)` = NULL —el guard no disparaba— y el
-- payload seguía hasta el `insert into awards`, que reventaba con un `23502`
-- crudo. Con `NOT EXISTS`, ese mismo NULL no matchea ninguna fila y el guard
-- dispara el mensaje en castellano de arriba. Es una mejora (más estricto,
-- mejor mensaje), no una regresión: el camino de la app nunca lo alcanza
-- (`computeAwards` siempre setea `entryId`), sólo un payload de RPC armado a
-- mano.
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
  -- no `not in` sobre un `union`: ver comentario de cabecera (C17).
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
