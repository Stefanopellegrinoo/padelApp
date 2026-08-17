-- PR 9 (torneo-multi-disciplina, soporte D1-3/D1-4) ────────────────────────
--
-- ── promote_guest: restatement #1/3 — discipline_entries del promovido ─────
-- 0023 (PR 7) dejó a `promote_guest` validando `p_before` sin reservarle
-- lugar en ningún lado: el invitado promovido no tenía fila propia en
-- `discipline_entries` todavía. Acá se la da, de la disciplina de LA FECHA en
-- la que jugó como invitado —no de "todas las de la temporada", como
-- `add_squad_seat`: promovido desde una fecha de FIFA, entra a jugar FIFA,
-- no pádel de arrastre—, con la MISMA mecánica de posicionamiento que
-- `add_squad_seat` (0023): `p_before` corre la cola con `shift_seeds_up` si
-- el asiento de referencia juega esta disciplina, o va al final si no.
--
-- El resto de la función sigue byte a byte igual a 0014_promote_guest.sql:
-- el porqué de cada guard y los tres casos aceptado/refusado del reparto
-- siguen documentados ahí, sin cambios. Delta contra el restatement de 0023:
--   1. el `select ... into v_status` de abajo también trae `discipline_id`
--      (misma fila, sin round trip nuevo).
--   2. después de validar `p_before` contra `entries` (guard de 0023, sigue
--      igual), se agrega la resolución de `v_disc_at` contra
--      `discipline_entries` — mecánica calcada de `add_squad_seat`.
--   3. un `insert into discipline_entries` nuevo, después del flip.
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

  select status, discipline_id into v_status, v_discipline
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

-- ── season_invite devuelve disciplinas ───────────────────────────────────────
-- La pantalla de Unirse (`app/unirse/[token]`) hoy sólo lista nombres: sin
-- saber qué disciplinas juega cada asiento, no hay forma de mostrarlo cuando
-- el plantel deje de ser 1:1 con "juega todo" (wizard multi-disciplina,
-- PR 11). `disciplines` sale como `text[]` de `kind`, en el mismo orden que
-- `position, created_at` — ninguna fila para un asiento sin disciplinas
-- (hoy no puede pasar; el `coalesce` es para no romper si alguna vez pasa).
-- Resto de la función byte a byte igual a 0004_claim_seat.sql.
--
-- `create or replace` no alcanza: Postgres no deja cambiar el tipo de
-- retorno de una función existente (42P13, "cannot change return type of
-- existing function") ni agregando una columna al final del `returns
-- table`. Drop explícito + create, mismo patrón que `add_squad_seat` (0023).
drop function public.season_invite(text);

create function public.season_invite(p_token text)
returns table (
  season_id     uuid,
  season_name   text,
  admin_name    text,
  squad_size    int,
  entry_id      uuid,
  display_name  text,
  seed_position int,
  claimed       boolean,
  disciplines   text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.name,
         admin.display_name,
         (select count(*)::int from public.entries e2
           where e2.season_id = s.id and e2.kind = 'SQUAD'),
         e.id,
         e.display_name,
         e.seed_position,
         e.player_id is not null,
         coalesce((
           select array_agg(d.kind order by d.position, d.created_at)
             from public.discipline_entries de
             join public.disciplines d on d.id = de.discipline_id
            where de.entry_id = e.id
         ), array[]::text[])
    from public.seasons s
    join public.players admin on admin.user_id = s.created_by
    join public.entries e on e.season_id = s.id and e.kind = 'SQUAD'
   where s.invite_token = p_token
   order by e.seed_position
$$;

revoke execute on function public.season_invite(text) from public, anon;
grant  execute on function public.season_invite(text) to authenticated;

-- claim_seat (0004_claim_seat.sql) NO cambia: reclamar un asiento es del
-- TORNEO, no de una disciplina — entries sigue siendo el plantel compartido
-- (REQ-D1-3), y discipline_entries no tiene ninguna noción de "quién lo
-- reclamó".
