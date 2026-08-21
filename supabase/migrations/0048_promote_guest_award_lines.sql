-- REQ-D10-3 (torneo-multi-disciplina, spec #3800, design #3801 PUNTO 8
-- "promote_guest (PR 24)", corregido por W35) ────────────────────────────
--
-- `promote_guest` ya copiaba el TOTAL congelado del compañero (`awards`,
-- restatement de 0031). Desde que `close_matchday` desglosa ese total en
-- `award_lines` (0047, D10 rebanada A), la copia queda a medias: el
-- invitado se lleva el número pero no el POR QUÉ. Este archivo agrega
-- exactamente eso -- un `insert` más, mismo `where`, misma forma de `case`
-- que la copia de `awards` -- y nada más.
--
-- Restatement de la ÚLTIMA versión, no del design: `0033` es la que define
-- `promote_guest` hoy (verificado con `rg -n 'promote_guest'
-- supabase/migrations/`, y con `rg -n '^create( or replace)? function|^drop
-- function' 0033_*.sql` -- UNA sola función, así que copiar el archivo
-- entero no revierte nada de otra función en silencio, la trampa de 0025).
--
-- El HALLAZGO NUEVO del design (que con `pair_size=1` la copia traía CERO
-- filas en silencio) es FALSO, medido: el guard de "¿el compañero cobró?"
-- (abajo, sin cambios) ya rechaza ANTES de llegar a la copia cuando el lado
-- es de uno, y el skip de ese guard (`v_pair_size <> 1 and exists (...)`)
-- ya vive desde `0031` (PR18c, slice D). Este archivo NO toca esa parte:
-- sólo agrega el insert de `award_lines`, adentro del MISMO `if v_pair_size
-- <> 1` que ya envuelve la copia de `awards` -- con un lado de uno no hay
-- compañero de quien copiar, y el invitado que jugó solo no tiene ni
-- `awards` ni `award_lines` propios que perder (`computeAwards` lo excluye
-- de las posiciones que pagan).
--
-- La FK compuesta de `award_lines` (`(matchday_id, entry_id) references
-- awards (matchday_id, entry_id) on delete cascade`, 0047) exige que la
-- fila de `awards` del invitado exista PRIMERO -- por eso este insert va
-- DESPUÉS del de `awards`, no antes ni en un bloque separado.

create or replace function public.promote_guest(p_entry uuid, p_before uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_matchday   uuid;
  v_discipline uuid;
  v_kind       text;
  v_name       text;
  v_status     text;
  v_at         int;
  v_disc_at    int;
  v_pair_size  int;
  v_squad      int;
  v_squad_raw  jsonb;
  v_points     jsonb;
begin
  select season_id, matchday_id, kind, display_name
    into v_season, v_matchday, v_kind, v_name
    from public.entries
   where id = p_entry
   for update;

  if v_season is null then
    raise exception 'Ese invitado no existe.';
  end if;

  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede sumar un invitado al plantel.';
  end if;

  if v_kind <> 'GUEST' then
    raise exception 'Ese asiento ya es del plantel.';
  end if;

  if trim(coalesce(v_name, '')) = '' then
    raise exception 'Falta ponerle nombre al invitado. Sin eso, no lo podés sumar al plantel.';
  end if;

  select status, discipline_id, pair_size into v_status, v_discipline, v_pair_size
    from public.matchdays where id = v_matchday for update;

  if v_status is null or v_status <> 'CLOSED' then
    raise exception '%', case
      when v_status is null then 'La fecha de este invitado ya no existe.'
      when v_status = 'DRAFT' then 'Esta fecha todavía se está armando. Sacalo de invitado y agregalo al plantel como uno más.'
      when v_status = 'OPEN' then 'Esta fecha está en juego y sus puntos se reparten al cerrarla. Cerrala primero y después sumalo.'
      else 'Esta fecha no está cerrada, así que todavía no repartió ningún punto.'
    end;
  end if;

  perform 1
     from public.pairs
    where matchday_id = v_matchday
      and (entry_a = p_entry or entry_b = p_entry);
  if not found then
    raise exception 'En esta fecha no quedó en ninguna pareja, así que no hay ningún punto suyo que conservar. Agregalo al plantel desde Ajustes › Plantel.';
  end if;

  -- Saltea con un lado de uno: no hay compañero de quien preguntar, y este
  --`case` devolvería NULL. Ver la cabecera del archivo.
  if v_pair_size <> 1 and exists (
    select 1
      from public.pairs pr
     where pr.matchday_id = v_matchday
       and (pr.entry_a = p_entry or pr.entry_b = p_entry)
       and not exists (
         select 1
           from public.awards a
          where a.matchday_id = pr.matchday_id
            and a.entry_id = case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end)
  ) then
    raise exception 'En esta fecha jugó en una pareja que no cobró puntos —lo habitual es que haya jugado con otro invitado—. Sumarlo acá le cambiaría los puntos a los demás, así que no se puede desde esta fecha.';
  end if;

  -- Guard de 0023, sin cambios: `p_before` tiene que ser un asiento SQUAD
  -- real de esta temporada, o se refusa ENTERO sin tocar nada.
  if p_before is not null then
    perform 1 from public.entries
     where id = p_before and season_id = v_season and kind = 'SQUAD';
    if not found then
      raise exception 'Ese jugador no está en el plantel.';
    end if;
  end if;

  select coalesce(max(seed_position), -1) + 1 into v_at
    from public.entries
   where season_id = v_season and kind = 'SQUAD';

  -- Restatement #1/3: la posición REAL, en discipline_entries de la
  -- disciplina de esta fecha — misma mecánica que el loop de
  -- `add_squad_seat` (0023), acá sin loop porque sólo hay una disciplina que
  -- llenar.
  if p_before is null then
    select coalesce(max(seed_position), -1) + 1 into v_disc_at
      from public.discipline_entries where discipline_id = v_discipline;
  else
    select seed_position into v_disc_at from public.discipline_entries
     where discipline_id = v_discipline and entry_id = p_before for update;
    if v_disc_at is null then
      -- El asiento de referencia no juega ESTA disciplina: va al final,
      -- mismo criterio que `add_squad_seat`.
      select coalesce(max(seed_position), -1) + 1 into v_disc_at
        from public.discipline_entries where discipline_id = v_discipline;
    else
      perform public.shift_seeds_up(v_discipline, v_disc_at);
    end if;
  end if;

  -- Decision de producto (Stefano): al sumar un invitado de a uno, la app
  -- agrega el casillero de puntos SOLA, con 0, y sube el plantel. El admin
  -- despues lo deja en 0 o le pone valor.
  --
  -- La lista de puntos tiene que tener un casillero por lado aunque valga 0
  -- (`core/config.ts: validateConfig`, `points.length === floor(squadSize /
  -- sideSize)`), y el 0 ya significa "de aca para abajo no se suma"
  -- (`pointsErrors`). Lo que trababa la temporada nunca fue una regla de
  -- reparto: era el LARGO. Sin esto, promover dejaba 9 jugadores contra 8
  --Valores, la fecha siguiente no se podia sortear y —C22,
  -- ronda 15— reabrir ESTA borraba los 8 premios y despues no dejaba cerrar.
  --
  -- Cambia a proposito la convencion de "agregar un asiento no toca squadSize
  -- ni points" (decision registrada 3): aca la app no elige un reparto,
  -- mantiene el invariante de largo que ella misma exige.
  --
  -- Solo con `pair_size = 1`. De a dos el invitado promovido no cambia los
  -- lados que cobran —su pareja ya cobraba porque el companero era del
  -- plantel—, asi que la lista sigue alcanzando; medido en la ronda 15
  -- (promover → reabrir → re-cerrar da 8 premios, perfecto).
  if v_pair_size = 1 then
    --Esto leia `(config ->> 'squadSize')::int` y
    -- el cast reventaba ACA, antes de que el guard de abajo pudiera mirar nada
    -- — con `squadSize = "ocho"` el admin recibia `invalid input syntax for
    --Type integer: "ocho"`, la ultima de las siete filas de la matriz de W54
    -- que le llegaba como "Referencia: NNNN". Se lee como jsonb, se chequea el
    -- tipo, y recien despues se castea.
    select config -> 'squadSize', config -> 'points'
      into v_squad_raw, v_points
      from public.disciplines where id = v_discipline for update;

    --`||` sobre un jsonb que no es array no se queja — escribe
    -- `[null,0]` o `[{},0]` y deja una config que `validateConfig` rechaza
    -- entera, incluido cualquier intento de arreglarla desde Ajustes. La
    -- config sale de `validateConfig` en todos los caminos de escritura, asi
    -- que llegar aca con otra forma es corrupcion; se corta ruidoso.
    if v_points is null or jsonb_typeof(v_points) <> 'array' then
      raise exception 'La configuración de la disciplina está rota: la lista de puntos no es una lista.';
    end if;
    if v_squad_raw is null or jsonb_typeof(v_squad_raw) <> 'number' then
      raise exception 'La configuración de la disciplina está rota: no dice de cuántos es el plantel.';
    end if;
    v_squad := (v_squad_raw #>> '{}')::int;

    -- 12 es MAX_PLAYERS (`core/constants.ts`). Duplicado a proposito y con
    -- tripwire: `core/constants.test.ts` fija el valor, asi que cambiarlo alla
    -- rompe alli y manda a mirar aca. Sin este guard, promover empujaria el
    -- plantel arriba del techo y `validateConfig` rechazaria la config entera
    -- —incluido cualquier intento de arreglarla desde Ajustes.
    --
    --El mensaje decia "Sacá a alguien antes de
    -- sumar" y los doce asientos rebotan al intentarlo, porque ya jugaron
    -- (`removeSeat`: "ya jugó alguna fecha"). Mandaba a una salida que no
    -- existe. Ahora nombra la unica que si: el invitado se queda invitado.
    if v_squad + 1 > 12 then
      raise exception 'El plantel ya está en el máximo de 12, así que % no se puede sumar. Puede seguir jugando de invitado las fechas que quieras.', v_name;
    end if;

    update public.disciplines
       set config = jsonb_set(
             jsonb_set(config, '{squadSize}', to_jsonb(v_squad + 1)),
             '{points}', v_points || to_jsonb(0))
     where id = v_discipline;
  end if;

  delete from public.pair_locks
   where matchday_id = v_matchday
     and (entry_a = p_entry or entry_b = p_entry);

  update public.entries
     set kind = 'SQUAD', matchday_id = null, seed_position = v_at
   where id = p_entry;

  insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
  values (v_discipline, p_entry, v_season, v_disc_at);

  -- Misma razón que el guard de arriba: con un lado de uno este `join` no
  -- puede traer una fila (el `case` da NULL), y no hay nada que copiar porque
  -- el invitado jugó solo y no cobró. Se saltea explícito en vez de dejar que
  -- el `join` no matchee, para que el motivo quede escrito y no dependa de
  -- volver a derivar la lógica de tres valores.
  if v_pair_size <> 1 then
    insert into public.awards (matchday_id, entry_id, season_id, position, points)
    select pr.matchday_id, p_entry, v_season, a.position, a.points
      from public.pairs pr
      join public.awards a
        on a.matchday_id = pr.matchday_id
       and a.entry_id = case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end
     where pr.matchday_id = v_matchday
       and (pr.entry_a = p_entry or pr.entry_b = p_entry);

    -- REQ-D10-3: el desglose del compañero, no sólo el total -- mismo `case`,
    -- mismo `where`, la FK compuesta a `awards (matchday_id, entry_id)`
    -- (0047) exige que el insert de arriba ya haya corrido.
    insert into public.award_lines (matchday_id, entry_id, ordinal, reason, points)
    select pr.matchday_id, p_entry, l.ordinal, l.reason, l.points
      from public.pairs pr
      join public.award_lines l
        on l.matchday_id = pr.matchday_id
       and l.entry_id = case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end
     where pr.matchday_id = v_matchday
       and (pr.entry_a = p_entry or pr.entry_b = p_entry);
  end if;
end;
$$;

revoke execute on function public.promote_guest(uuid, uuid) from public, anon;
grant  execute on function public.promote_guest(uuid, uuid) to authenticated;
