-- ── close_matchday (restatement de 0041_close_matchday_third_place_optional.sql) ─
-- C31 (verify-report-pr21, #4004): la rendija de `0041` mira SÓLO `m.fase`,
-- nunca `matchdays.formato` — así que alcanza a una fecha `ROUND_ROBIN`.
--
-- Camino reproducido con funciones de producción, rol `authenticated`:
-- 1. Armar `GROUPS_KNOCKOUT`, jugar hasta la FINAL con el TERCER_PUESTO
--    vacío (la fila queda en `matches`, decisión #3979).
-- 2. `redraft_matchday` (0011:7-9, "no borra parejas ni partidos") → OPEN a
--    DRAFT. La fila de TERCER_PUESTO sigue ahí.
-- 3. `setMatchdayFormat(md, {kind:'ROUND_ROBIN'})` → legal, la fecha está en
--    DRAFT (`db/matchday.ts: setMatchdayFormat`, REQ-D8-1: "editable antes
--    de armar").
-- 4. `openMatchday` → OPEN, sin re-sortear: la fila vieja de TERCER_PUESTO
--    sigue en `matches`.
-- 5. `closeMatchday` → CIERRA. La rendija de 0041 salta CUALQUIER fila
--    `fase = 'TERCER_PUESTO'`, sin mirar si la fecha sigue siendo la llave
--    que la generó.
--
-- Esto contradice #3988 palabra por palabra: "una fecha de pádel
-- `ROUND_ROBIN` con un partido sin cargar sigue trabando el cierre. La
-- excepción es una rendija de una sola FASE, no un permiso general" — hoy
-- es un permiso general en cuanto la fila sobrevive a un cambio de formato.
--
-- Las DOS premisas de la cabecera de 0041 son FALSAS y se corrigen acá:
-- (a) "el riesgo para el pádel es CERO POR CONSTRUCCIÓN... un partido de
--     TERCER_PUESTO no existe ni puede existir en una fecha de pádel" — es
--     falso: `suggestFormat(12, 2)` (core/knockout.ts) SÍ propone
--     `GROUPS_KNOCKOUT` para el pádel de 12 (medido; PnP-1000 juega de a
--     12), así que una fecha de pádel puede tener una llave con TERCER_PUESTO
--     como cualquier otra disciplina.
-- (b) "una fecha ROUND_ROBIN nunca manda `fase` distinta de GRUPO" — cierto
--     SÓLO al ARMAR (`roundRobinMatches` nunca la escribe), pero
--     `redraft_matchday` no borra `matches` (0011) y `formato` se puede
--     cambiar en DRAFT con la llave todavía adentro: una fecha puede LLEGAR
--     a `ROUND_ROBIN` con filas de fase de llave que un armado anterior dejó.
--
-- Arreglo: la rendija ahora exige TAMBIÉN que el `formato` VIGENTE de la
-- fecha sea `GROUPS_KNOCKOUT` — no sólo que la fila sea TERCER_PUESTO. Con
-- `ROUND_ROBIN`, cualquier partido sin resultado sigue trabando el cierre,
-- sin excepción, que es exactamente lo que #3988 fijó por escrito. El resto
-- de la función (0041) no cambia una línea salvo el `select` que ahora
-- también trae `formato`.
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
  v_formato    jsonb;
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
  -- no `not in` sobre un `union`: ver comentario de cabecera.
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
       -- La rendija (C31, ver comentario de cabecera): TERCER_PUESTO queda
       -- afuera de este chequeo SÓLO si la fecha sigue siendo la llave que
       -- lo generó (`formato.kind = 'GROUPS_KNOCKOUT'`). Con `ROUND_ROBIN`
       -- —incluida una fecha que LLEGÓ ahí después de tener una llave— no
       -- hay excepción: cualquier otra fase, y siempre en el pádel, sigue
       -- exigiendo resultado como hoy.
       and not (m.fase = 'TERCER_PUESTO' and v_formato ->> 'kind' = 'GROUPS_KNOCKOUT')
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
