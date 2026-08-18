-- PR 18c bis (torneo-multi-disciplina) ─────────────────────────────────────
--
-- ── promote_guest: restatement #3/3 — el casillero de puntos del promovido ─
-- C22 (verify-report ronda 15). PR18c dejo que un invitado que jugo solo se
-- sumara al plantel, y con eso la temporada quedaba trabada: 9 jugadores
-- contra 8 valores de puntos. La fecha siguiente no se podia sortear, y
-- reabrir la fecha ya jugada BORRABA sus 8 premios y despues no dejaba
-- cerrarla — sin salida desde ninguna pantalla, porque Ajustes → Formato no
-- tiene control para agregar un valor a la lista (W47).
--
-- Delta contra 0031, y nada mas: con `pair_size = 1`, despues de validar todo
-- y antes del flip, se agrega un 0 al final de `config.points` y se sube
-- `config.squadSize` en uno.
--
-- CUIDADO al re-copiar: `0025_promote_guest_discipline_entries.sql` define DOS
-- funciones (`promote_guest` y un drop+create de `season_invite` que `0026` ya
-- reemplazo). Copiar "hasta el final del archivo" revierte 0026 en silencio;
-- paso al escribir `0031`. Esta migracion define UNA funcion — lo fija
-- `db/migrations.unit.test.ts`.

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
  -- `case` devolvería NULL (W35). Ver la cabecera del archivo.
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
  -- valores, la fecha siguiente no se podia sortear y —C22, verify-report
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
    select (config ->> 'squadSize')::int, config -> 'points'
      into v_squad, v_points
      from public.disciplines where id = v_discipline for update;

    -- 12 es MAX_PLAYERS (`core/constants.ts`). Duplicado a proposito y con
    -- tripwire: `core/constants.test.ts` fija el valor, asi que cambiarlo alla
    -- rompe alli y manda a mirar aca. Sin este guard, promover empujaria el
    -- plantel arriba del techo y `validateConfig` rechazaria la config entera
    -- —incluido cualquier intento de arreglarla desde Ajustes.
    if v_squad + 1 > 12 then
      raise exception 'El plantel ya esta en el maximo de 12. Sacá a alguien antes de sumar a %.', v_name;
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
  end if;
end;
$$;

revoke execute on function public.promote_guest(uuid, uuid) from public, anon;
grant  execute on function public.promote_guest(uuid, uuid) to authenticated;
