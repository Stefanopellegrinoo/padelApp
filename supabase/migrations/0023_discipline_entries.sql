-- PR 7 (torneo-multi-disciplina, REQ-D1-3/D1-4) ────────────────────────────
--
-- `entries` sigue siendo el plantel del TORNEO (un asiento, una persona, sin
-- duplicar por disciplina — REQ-D1-3). Lo que faltaba es DÓNDE juega cada
-- asiento: `discipline_entries` es el subconjunto por disciplina (REQ-D1-4,
-- "no todos juegan todo") con su PROPIO `seed_position`, independiente del de
-- las demás disciplinas del mismo torneo.
--
-- REEMPLAZA a `entries_seed` (0001_schema.sql:86) como fuente del orden de
-- desempate real. `entries_seed` sobrevive hasta PR 25 porque el dual-write
-- de `add_squad_seat`/`promote_guest` (más abajo) lo sigue alimentando, y es
-- lo que hace rollbackeable esta PR.
create table public.discipline_entries (
  discipline_id uuid not null,
  entry_id      uuid not null,
  season_id     uuid not null,
  seed_position int  not null check (seed_position >= 0),
  -- Idioma de `attendances.entry_kind` (0001_schema.sql:102,113): la mitad
  -- FIJA de una FK compuesta. Esto —no un comentario— hace que un GUEST
  -- nunca tenga seed de disciplina.
  entry_kind    text not null default 'SQUAD' check (entry_kind = 'SQUAD'),
  created_at    timestamptz not null default now(),
  primary key (discipline_id, entry_id),   -- PK natural: nada referencia esta tabla
  foreign key (discipline_id, season_id) references public.disciplines (id, season_id) on delete cascade,
  foreign key (entry_id, season_id)      references public.entries     (id, season_id) on delete cascade,
  foreign key (entry_id, entry_kind)     references public.entries     (id, kind)
);
create unique index discipline_entries_seed     on public.discipline_entries (discipline_id, seed_position);
create index        discipline_entries_by_entry on public.discipline_entries (entry_id);

-- Backfill: cada SQUAD existente entra a la (única) disciplina de su
-- temporada con el mismo `seed_position` que ya tenía. Válido en el orden
-- real de despliegue: para cuando esta migración corre, ninguna temporada
-- tiene más de una disciplina todavía (el wizard multi-disciplina es PR 11,
-- "agregar disciplina en curso" es PR 13) — con dos, este `insert` metería
-- una fila por cada combinación entry×disciplina, y la aserción de abajo lo
-- habría dicho.
insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
select d.id, e.id, e.season_id, e.seed_position
  from public.entries e join public.disciplines d on d.season_id = e.season_id
 where e.kind = 'SQUAD';

do $$ declare v_want int; v_got int; begin
  select count(*) into v_want from public.entries where kind = 'SQUAD';
  select count(*) into v_got  from public.discipline_entries;
  if v_want <> v_got then
    raise exception 'Backfill incompleto: % asientos SQUAD, % filas.', v_want, v_got;
  end if;
end $$;

-- Sin este grant de tabla, tanto `authenticated` como `service_role` reciben
-- "permission denied for table discipline_entries": tabla NUEVA creada
-- después de 0002_rls.sql, así que su blanket grant no la alcanzó (mismo
-- gotcha que `disciplines`, 0015_disciplines.sql:48-52).
grant select, insert, update, delete on public.discipline_entries to authenticated, service_role;

alter table public.discipline_entries enable row level security;
create policy discipline_entries_read on public.discipline_entries
  for select to authenticated using (public.is_participant(season_id));
create policy discipline_entries_write on public.discipline_entries
  for all to authenticated
  using (public.is_season_admin(season_id)) with check (public.is_season_admin(season_id));
-- Mismo motivo que `disciplines` (0020_disciplines_grants.sql) y
-- `matchdays` (0009_anon_surface.sql): tabla nueva, `anon` no tiene ningún
-- negocio acá. Sin este revoke, `anon` hereda TRUNCATE (no sujeto a RLS) por
-- el mismo agujero que se cerró para `disciplines` — no se repite acá.
revoke all on public.discipline_entries from anon;

-- ── Ubicar al que llega en el orden de desempate, ahora POR DISCIPLINA ──────
-- Restatement de 0013_squad_seat_position.sql: TODO el comentario original
-- (líneas 1-90 de ese archivo) sigue vigente palabra por palabra sobre POR
-- QUÉ el corrimiento existe y por qué es en dos pasadas. Lo único que cambia
-- es SOBRE QUÉ TABLA corre — `discipline_entries`, no `entries` — y por eso
-- desaparece el filtro `and kind = 'SQUAD'`: la FK `(entry_id, entry_kind)`
-- hace que la tabla entera sea SQUAD por construcción.
--
-- **Por qué un uuid y no una posición.** `removeSeat` (db/entries.ts) deja
-- huecos en `seed_position` a propósito —cascadea desde `entries` y se lleva
-- la fila de `discipline_entries` con él—: sacar a alguien no renumera a los
-- demás, porque eso reescribiría el orden de desempate inicial de todo el
-- plantel por dar de baja a UNO. Con huecos, "posición 3" es ambiguo y además
-- queda vieja apenas alguien más entra o sale entre que se mira la pantalla y
-- se confirma el alta. "Antes de Juan" no tiene ninguno de los dos problemas.
--
-- **Por qué insertar y no un swap adyacente.** Insertar corre una cola
-- contigua un lugar y no toca el orden relativo de nadie más — la prueba pura
-- vive en `core/snapshots.test.ts`. Un swap invierte exactamente un par, y
-- `snapshotForMatchday` reconstruye el desempate de CADA fecha desde el orden
-- de seed VIVO en cada render: un swap cambiaría, con efecto retroactivo, el
-- desempate ya mostrado de fechas que ya se jugaron.
--
-- **El corrimiento es en dos pasadas ("parking"), no un `seed_position + 1`
-- directo.** `discipline_entries_seed` (acá arriba) es un índice único, y un
-- índice único no se puede declarar `deferrable`, así que cada fila que el
-- UPDATE escribe tiene que dejar la tabla consistente EN ESE INSTANTE, no al
-- final de la transacción. Y `seed_position >= 0` es un CHECK (acá arriba),
-- así que "parkear" corriendo todo a negativo tampoco es legal.
--
-- Con M = max(seed_position) de la disciplina y `v_park := M + 2`:
--   pasada 1: `seed_position += v_park` donde `seed_position >= p_from`
--             origen [p_from, M] → destino [p_from+M+2, 2M+2]
--   pasada 2: `seed_position -= v_park - 1` donde `seed_position >= v_park`
--             origen [p_from+M+2, 2M+2] → destino [p_from+1, M+1]
--
-- El `UPDATE` no tiene `ORDER BY` y no lo puede tener: en qué orden el motor
-- visita las filas lo elige el planner —un Index Scan sube por seed_position,
-- un Seq Scan sobre un heap descendente baja— y eso cambia solo con un
-- `ANALYZE`. Así que cada pasada tiene que ser segura en CUALQUIER orden, y
-- para eso hay que probar CUATRO cosas, no dos:
--   1. pasada 1 vs. las quietas [0, p_from-1]: su destino arranca en
--      p_from+M+2, que es > M. Disjunto para todo p_from >= 0.
--   2. pasada 1 vs. su propio origen [p_from, M]: mismo número, p_from+M+2
--      es > M. Disjunto para todo p_from >= 0.
--   3. pasada 2 vs. las quietas [0, p_from-1]: su destino arranca en
--      p_from+1, que es > p_from-1. Disjunto para todo p_from >= 0.
--   4. pasada 2 vs. su propio origen: acá no hace falta NINGUNA condición
--      sobre p_from. El `where` de la pasada 2 es `seed_position >= v_park`,
--      así que la fila más baja que puede llegar a tocar está en M+2 pase lo
--      que pase, y su destino más alto es M+1. M+1 < M+2 y se terminó:
--      disjunto para CUALQUIER p_from —también negativo— y con cualquier
--      patrón de huecos.
--
-- El punto 4 es el que costó caro y es la razón del +2. Con `v_park := M + 1`
-- la cuenta daba M+1 < p_from+M+1, que es cierto sólo si p_from > 0: fallaba
-- en EXACTAMENTE un caso —insertar primero de todos, p_from = 0— y en
-- exactamente un punto, la posición M+1. Ahí la fila que estaba en M aterriza
-- encima de la que estaba en 0, que sigue parkeada porque todavía no le tocó.
-- Si el motor visita la primera antes que la segunda, 23505 y se cae la
-- función entera. Con Index Scan sube y zafa de casualidad; con Seq Scan sobre
-- un heap descendente explota. El margen que hace falta es UNO y eso es
-- exactamente lo que compra el +2: separa los rangos sin importar el orden de
-- visita. `db/squad-position.db.test.ts` fuerza el plan adverso, migrado a
-- `discipline_entries` en esta misma PR, para que no vuelva.
--
-- `v_park` sale de `max(seed_position)` y NUNCA de un `count`: los huecos de
-- `removeSeat` hacen que contar mienta.
--
-- `shift_seeds_up` es una función PLANA —ni siquiera `security definer`— a la
-- que se le saca el `execute` a `public`, `anon` Y `authenticated`: nadie la
-- llama por RPC nunca, sólo la llaman `add_squad_seat` (acá abajo) y
-- `promote_guest` (0014_promote_guest.sql, restatement acá abajo). No
-- necesita ser DEFINER porque durante la ejecución de una función DEFINER el
-- rol activo YA es el dueño de esa función; una función plana llamada desde
-- adentro hereda ese rol sin pedirlo.
--
-- ponytail: dos admins agregando a la vez en la misma disciplina leen el
-- mismo `max(seed_position)` y calculan el mismo `v_park`, así que el segundo
-- corre la cola con un `v_park` que se le quedó viejo apenas el primero
-- commiteó. Techo conocido y aceptado desde 0013, no resuelto acá: si dos
-- admins editando el mismo plantel a la vez deja de ser anecdótico, la
-- solución es un advisory lock por `discipline_id`.
--
-- Sin grant que rehacer: `shift_seeds_up` está revocada de todos.
drop function public.shift_seeds_up(uuid, int);

create function public.shift_seeds_up(p_discipline uuid, p_from int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_park int;
begin
  select coalesce(max(seed_position), -1) + 2 into v_park
    from public.discipline_entries
   where discipline_id = p_discipline;

  update public.discipline_entries
     set seed_position = seed_position + v_park
   where discipline_id = p_discipline and seed_position >= p_from;

  update public.discipline_entries
     set seed_position = seed_position - v_park + 1
   where discipline_id = p_discipline and seed_position >= v_park;
end;
$$;

revoke execute on function public.shift_seeds_up(uuid, int) from public, anon, authenticated;

-- Agrega un asiento SQUAD. `p_disciplines = null` (el default) lo suma a
-- TODAS las disciplinas de la temporada — hoy es siempre una sola, hasta el
-- wizard multi-disciplina (PR 11) — con `p_before` reservando su lugar en
-- CADA una de ellas por separado.
--
-- Agregar un parámetro con default a una función existente NO es compatible
-- de forma directa: la llamada de 3 argumentos (`add_squad_seat(uuid, text,
-- uuid)`) quedaría AMBIGUA entre las dos firmas y Postgres tira "function ...
-- is not unique". Drop explícito + regrant, mismo patrón que
-- `shift_seeds_up` arriba.
--
-- DUAL-WRITE de `entries.seed_position` hasta PR 25, SIEMPRE al final
-- (`v_tail`, `max + 1`), nunca corrido con parking: correr las dos tablas con
-- parking en la misma transacción duplicaría el algoritmo más delicado del
-- schema por un valor que ya es legacy —`discipline_entries` es la fuente
-- real de acá en más—. TECHO ACEPTADO: un `p_before` puntual ya NO reserva
-- lugar en `entries`, sólo en `discipline_entries`. Degradación visible
-- (`entries.seed_position` dejó de significar "el orden real"), no
-- corrupción: nada rompe, `discipline_entries` es lo que las pantallas van a
-- terminar leyendo.
drop function public.add_squad_seat(uuid, text, uuid);

create function public.add_squad_seat(
  p_season uuid, p_name text, p_before uuid default null,
  p_disciplines uuid[] default null   -- null = todas las de la temporada
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_at int; v_disc uuid; v_tail int;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede agregar un asiento.';
  end if;
  if coalesce(p_name, '') !~ '\S' then
    raise exception 'El asiento necesita un nombre.';
  end if;

  -- Guard que 0013 ya tenía sobre `entries` y que el corrimiento a
  -- `discipline_entries` no puede perder: un `p_before` que no es NINGÚN
  -- asiento SQUAD de esta temporada se rechaza ENTERO, sin agregar nada — no
  -- alcanza con "no está en la disciplina que estoy iterando" (eso, más
  -- abajo, es el caso legítimo "no juega esta disciplina" y va al final ahí,
  -- no en todas).
  if p_before is not null then
    perform 1 from public.entries
     where id = p_before and season_id = p_season and kind = 'SQUAD';
    if not found then
      raise exception 'Ese jugador no está en el plantel.';
    end if;
  end if;

  select coalesce(max(seed_position), -1) + 1 into v_tail
    from public.entries where season_id = p_season and kind = 'SQUAD';
  insert into public.entries (season_id, kind, display_name, seed_position)
  values (p_season, 'SQUAD', trim(p_name), v_tail) returning id into v_id;

  for v_disc in
    select d.id from public.disciplines d
     where d.season_id = p_season and (p_disciplines is null or d.id = any(p_disciplines))
     order by d.position, d.created_at
  loop
    if p_before is null then
      select coalesce(max(seed_position), -1) + 1 into v_at
        from public.discipline_entries where discipline_id = v_disc;
    else
      select seed_position into v_at from public.discipline_entries
       where discipline_id = v_disc and entry_id = p_before for update;
      if v_at is null then
        -- El asiento de referencia no juega ESTA disciplina: va al final acá
        -- y en su lugar en las que sí. No hay lugar que respetar.
        select coalesce(max(seed_position), -1) + 1 into v_at
          from public.discipline_entries where discipline_id = v_disc;
      else
        perform public.shift_seeds_up(v_disc, v_at);
      end if;
    end if;
    insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
    values (v_disc, v_id, p_season, v_at);
  end loop;
  return v_id;
end; $$;

revoke execute on function public.add_squad_seat(uuid, text, uuid, uuid[]) from public, anon;
grant  execute on function public.add_squad_seat(uuid, text, uuid, uuid[]) to authenticated;

-- ── promote_guest: restatement quirúrgico, forzado por lo de arriba ─────────
-- `shift_seeds_up` deja de tocar `entries` (ahora corre `discipline_entries`,
-- ver arriba), y `promote_guest` (0014_promote_guest.sql:356) era la OTRA
-- llamadora que le quedaba: `perform public.shift_seeds_up(v_season, v_at)`
-- reservaba el lugar de `p_before` en `entries` antes del flip de abajo. Sin
-- tocar esto, esa reserva deja de pasar pero el `update entries set
-- seed_position = v_at` de más abajo se queda IGUAL, así que colisiona con
-- `entries_seed` (0001_schema.sql:86, todavía viva hasta PR 25) apenas
-- alguien promueva con `p_before` puntual — `db/promote.db.test.ts` lo
-- prueba y rompía en verde antes de este restatement.
--
-- El resto de esta función es BYTE A BYTE igual a 0014_promote_guest.sql: el
-- porqué de cada guard, los tres casos aceptado/refusado del reparto, el
-- techo de concurrencia y todo lo demás siguen documentados ahí sin cambios
-- — nada de eso depende de DÓNDE se reserva el `seed_position` de `entries`.
-- Igual que `add_squad_seat` (más arriba), el asiento entra al final de
-- `entries` (dual-write, degradación visible, no corrupción); darle su
-- propia fila en `discipline_entries` es la próxima PR (torneo-multi-
-- disciplina, PR 9, "promote_guest restatement #1/3").
--
-- `p_before` se sigue validando con el MISMO mensaje que siempre: tiene que
-- ser un asiento SQUAD real de esta temporada, o se refusa ENTERO sin tocar
-- nada — sólo deja de decidir la posición en `entries`.
create or replace function public.promote_guest(p_entry uuid, p_before uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season   uuid;
  v_matchday uuid;
  v_kind     text;
  v_name     text;
  v_status   text;
  v_at       int;
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

  select status into v_status from public.matchdays where id = v_matchday for update;

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

  if exists (
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

  -- Restatement: `p_before` se valida igual que siempre (mismo mensaje), pero
  -- ya no decide dónde cae en `entries` — ver el comentario grande de arriba.
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

  delete from public.pair_locks
   where matchday_id = v_matchday
     and (entry_a = p_entry or entry_b = p_entry);

  update public.entries
     set kind = 'SQUAD', matchday_id = null, seed_position = v_at
   where id = p_entry;

  insert into public.awards (matchday_id, entry_id, season_id, position, points)
  select pr.matchday_id, p_entry, v_season, a.position, a.points
    from public.pairs pr
    join public.awards a
      on a.matchday_id = pr.matchday_id
     and a.entry_id = case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end
   where pr.matchday_id = v_matchday
     and (pr.entry_a = p_entry or pr.entry_b = p_entry);
end;
$$;

revoke execute on function public.promote_guest(uuid, uuid) from public, anon;
grant  execute on function public.promote_guest(uuid, uuid) to authenticated;
