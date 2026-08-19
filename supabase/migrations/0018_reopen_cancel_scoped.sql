-- ── reopen_matchday y cancel_matchday, scopeadas por disciplina ────────────
-- El tripwire `disciplines_one_per_season` (0015) hacía IMPOSIBLE que estas
-- dos funciones se equivocaran de disciplina: sólo podía haber una por
-- temporada, así que filtrar por `season_id` o por `discipline_id` daba
-- exactamente lo mismo. Esta migración arregla las dos funciones Y SACA el
-- índice EN EL MISMO ARCHIVO — el CLI de Supabase corre cada migración en una
-- transacción, así que no puede existir un commit donde el índice ya permita
-- una segunda disciplina pero las funciones todavía asuman una sola. O las
-- dos cosas pasan juntas, o ninguna.

-- ── reopen_matchday (restatement de 0005_matchday_moves.sql:134-199) ────────
-- Único cambio real: las tres consultas que antes filtraban `season_id =
--V_season` ahora filtran `discipline_id = v_discipline` (REQ-D4-1) — "borrar
-- la DRAFT vacía siguiente", "¿hay otra fecha sin cerrar?" y "¿hay una fecha
-- posterior ya cerrada?" son preguntas sobre EL CALENDARIO DE ESA DISCIPLINA,
-- no de todo el torneo. Con dos disciplinas, una fecha DRAFT de FIFA no tiene
-- nada que ver con reabrir la última cerrada de pádel, y una fecha de FIFA
-- sin cerrar no puede bloquear esa reapertura.
--
-- `discipline_id` se lee en el MISMO `select ... for update` que ya
-- bloqueaba la fila (junto con number/status/kind), no con una consulta
-- aparte antes del lock: así, si la fecha desaparece entre el arranque de la
-- función y el lock, `v_status` y `v_discipline` quedan null JUNTOS, y el
-- resto del cuerpo (sin cambios) sigue el mismo camino que ya tenía para ese
-- caso — no se introduce ninguna ventana nueva.
--
-- El trinquete de `seasons.status` para el Masters (0005:190-193) NO se
-- toca: sigue siendo a nivel temporada, a propósito. `disciplines.status`
-- todavía no tiene ninguna función que lo mueva a ACTIVE en este corte (eso
-- es de una fase posterior), así que no hay nada que reabrir acá.
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

  -- El error de carga se descubre justo cuando arrancás la fecha siguiente, y
  -- para entonces esa fecha suele ser una fila con un número y nada más. Si
  -- está vacía se borra sola: no hay nada que perder. Si ya tiene asistencias,
  -- invitados o parejas, no se toca y el exists de abajo frena la reapertura.
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

  -- Reabrir el Masters devuelve la temporada a en curso. Sin esto, el año
  -- quedaría FINISHED con su última jornada abierta.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'ACTIVE' where id = v_season;
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;

-- ── cancel_matchday (restatement de 0012_cancel_matchday.sql:95-139) ────────
-- El guard `if v_status is null` (documentado en 0012, líneas 1-38: la
-- fecha que desaparece entre la lectura y el lock tiene que REFUSARSE, no
-- devolver éxito con cero filas borradas) NO se toca. `discipline_id` se lee
-- en el MISMO `select ... for update` que ya traía `status`, así que esa
-- garantía cubre a `v_discipline` gratis: si la fila desaparece antes del
-- lock, los dos quedan null juntos y la rama de arriba los frena a los dos.
--
--Lo nuevo es el segundo trinquete (REQ-D4-2): el de `seasons.status`
-- (0012:131-134) sigue exactamente igual —season_id, sin tocar—, porque a
-- nivel temporada "¿quedó alguna fecha en todo el torneo?" sigue siendo la
-- pregunta correcta. Se agrega uno gemelo para `disciplines.status`,
-- scopeado por discipline_id: sin él, cancelar la única fecha de pádel deja
-- `disciplines.status` en ACTIVE con cero fechas, aunque `seasons.status` ni
-- se mueva porque FIFA sigue con actividad en la misma temporada.
create or replace function public.cancel_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_status     text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede borrar una fecha.';
  end if;

  select discipline_id, status into v_discipline, v_status
    from public.matchdays where id = p_matchday for update;
  if v_status is null then
    raise exception 'La fecha no existe.';
  end if;
  if v_status not in ('DRAFT', 'OPEN') then
    raise exception 'Una fecha cerrada no se borra. Si hay que corregirla y es la última cerrada, reabrila.';
  end if;

  delete from public.matchdays where id = p_matchday;

  -- El trinquete de `open_matchday` (0005:37) al revés, a nivel temporada:
  -- sólo si no quedó ninguna fecha en TODO el torneo.
  update public.seasons set status = 'SETUP'
   where id = v_season
     and status = 'ACTIVE'
     and not exists (select 1 from public.matchdays where season_id = v_season);

  -- El mismo trinquete, a nivel disciplina: sólo si no quedó ninguna fecha
  -- en ESTA disciplina.
  update public.disciplines set status = 'SETUP'
   where id = v_discipline
     and status = 'ACTIVE'
     and not exists (select 1 from public.matchdays where discipline_id = v_discipline);
end;
$$;

revoke execute on function public.cancel_matchday(uuid) from public, anon;
grant  execute on function public.cancel_matchday(uuid) to authenticated;

-- ── el tripwire cae ──────────────────────────────────────────────────────────
-- Recién ACÁ, después de que las dos funciones de arriba ya están scopeadas
-- por discipline_id. Una temporada ya puede tener más de una disciplina.
drop index public.disciplines_one_per_season;
