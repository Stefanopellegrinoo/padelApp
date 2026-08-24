-- PR 18c (torneo-multi-disciplina, slice D re-especificada) ────────────────
--
-- ── promote_guest: restatement #2/3 — un lado de uno no tiene compañero ────
-- midió `promote_guest` contra una disciplina
-- `pair_size = 1` con la fecha CERRADA y encontró que el design se equivocaba
-- en las dos puntas. El design decía que la copia final traía 0 filas EN
-- SILENCIO y proponía agregar un `raise` para que fallara ruidoso. La medición
-- mostró que:
--
--   1. ya falla ruidoso, así que el `raise` propuesto era REDUNDANTE;
--   2. falla por el guard EQUIVOCADO, así que además era INSUFICIENTE: no
--      resolvía el caso legítimo, lo dejaba igual de bloqueado.
--
-- El guard que dispara es el de "¿el compañero cobró?" (0025:80-91), 60 líneas
-- antes de la copia. Arma el compañero con
--
--     case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end
--
-- y con un lado de uno `pr.entry_b` es NULL, así que `a.entry_id = NULL` no
-- matchea NUNCA, `not exists` da TRUE y el guard concluye "no cobró". Es la
-- misma lógica de tres valores que C17 con el
-- resultado OPUESTO: acá el NULL cae del lado conservador y refusa de más.
--
-- Delta contra 0025, y nada más:
--   1. el `select ... into v_status, v_discipline` también trae `pair_size`
--      (misma fila, sin round trip nuevo — igual que hizo 0025 con
--      `discipline_id`).
--   2. el guard del compañero se saltea con `v_pair_size = 1`.
--   3. la copia de `awards` se saltea con `v_pair_size = 1`.
--
-- Por qué SALTEAR y no refusar: en una disciplina de a uno el invitado ES su
-- propio lado y no cobró nada al cerrar — `computeAwards` saltea los lados
-- hechos sólo de invitados, por eso no tiene fila en `awards`. No hay puntos
-- que conservar ni que copiar, y sumarlo al plantel NO le mueve la posición a
-- nadie: las filas de los demás quedan intactas. El motivo por el que la
-- versión de a dos refusa —"sumarlo acá le cambiaría los puntos a los demás"—
-- simplemente no aplica cuando no hubo pareja.
--
-- El resto sigue byte a byte igual a 0025: el guard de "no quedó en ninguna
-- pareja" SÍ corre para las dos formas (un lado de uno tiene su propia fila en
-- `pairs`, con `entry_a` = el invitado y `entry_b` nulo, así que `entry_a =
-- p_entry` lo encuentra), y `p_before`/`shift_seeds_up`/`discipline_entries`
-- no se tocan.
--
-- CUIDADO al re-copiar de 0025: ese archivo define DOS funciones —
-- `promote_guest` y, 20 líneas más abajo, un `drop`+`create` de
-- `season_invite`— y la segunda fue REEMPLAZADA por
--`0026_season_invite_discipline_order.sql` (W10, el orden por
-- `discipline_entries`). Copiar "desde `promote_guest` hasta el final del
-- archivo" arrastra la versión vieja de `season_invite` y revierte 0026 en
-- silencio: el typecheck, el build y 305 de los 306 tests siguen en verde y
-- sólo cae `db/claim.db.test.ts`. Pasó exactamente eso al escribir este
-- archivo. Esta migración define UNA función y nada más.

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
  end if;
end;
$$;

revoke execute on function public.promote_guest(uuid, uuid) from public, anon;
grant  execute on function public.promote_guest(uuid, uuid) to authenticated;
