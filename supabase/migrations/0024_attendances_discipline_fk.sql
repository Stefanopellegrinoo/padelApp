-- PR 8 (torneo-multi-disciplina, cierra el agujero que D1 abre) ────────────
--
-- Sin esto se puede marcar presente, en una fecha de FIFA, a alguien que
-- sólo juega pádel: `attendances` sólo exigía `(entry_id, season_id)`, y
-- multi-disciplina hace que "del torneo" ya no alcance para decir "de esta
-- disciplina". `pairs` NO puede recibir la FK análoga —los GUEST juegan y no
-- tienen fila en `discipline_entries`—; hereda la garantía transitivamente
-- porque `present` (db/matchday.ts) sale de `attendances`.
alter table public.attendances add column discipline_id uuid;
update public.attendances a set discipline_id = m.discipline_id
  from public.matchdays m where m.id = a.matchday_id;
alter table public.attendances alter column discipline_id set not null;

alter table public.attendances
  -- La fecha de la asistencia tiene que ser de la MISMA disciplina que la
  -- asistencia — mismo idioma que la FK de season_id dos líneas más arriba
  -- (0001_schema.sql:108). `matchdays_discipline_anchor` (0016) es el ancla.
  add constraint attendances_matchday_discipline
    foreign key (matchday_id, discipline_id) references public.matchdays (id, discipline_id) on delete cascade,
  -- La garantía nueva: el asiento tiene que JUGAR esa disciplina. La PK de
  -- `discipline_entries` es `(discipline_id, entry_id)` — ancla directa, sin
  -- índice extra.
  add constraint attendances_entry_discipline
    foreign key (discipline_id, entry_id) references public.discipline_entries (discipline_id, entry_id) on delete cascade;

-- Tabla existente desde 0001 (antes de 0002_rls.sql): su blanket grant de
-- tabla ya cubre esta columna nueva, columna nueva no repite el gotcha de
-- `disciplines`/`discipline_entries`. Sin narrowing de columnas sobre
-- `attendances` en ningún lado (a diferencia de `matchdays`), no hace falta
-- ningún grant adicional.

-- ── set_my_attendance: restatement forzado por el NOT NULL de arriba ────────
-- `set_my_attendance` (0007_write_screens.sql:12-57) inserta en `attendances`
-- sin `discipline_id`; con la columna ya NOT NULL, ese insert pasaría a
-- rechazar TODO marcado de presencia propio con 23502. `matchday_season`
-- (0002_rls.sql) ya resuelve `season_id` desde `p_matchday`; acá hace falta
-- lo mismo para `discipline_id`, así que se lee junto con el resto de la fila
-- de `matchdays` en vez de sumar una función nueva de una sola línea.
-- Restatement quirúrgico: el resto es byte a byte igual a 0007.
create or replace function public.set_my_attendance(p_matchday uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_entry      uuid;
begin
  if p_status not in ('PLAYING', 'ABSENT') then
    raise exception 'El presentismo sólo puede ser PLAYING o ABSENT.';
  end if;

  select season_id, discipline_id into v_season, v_discipline
    from public.matchdays where id = p_matchday;
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;

  if not exists (
    select 1 from public.matchdays where id = p_matchday and status = 'DRAFT'
  ) then
    raise exception 'La fecha ya está armada: hablá con quien organiza.';
  end if;

  select e.id into v_entry
    from public.entries e
    join public.players p on p.id = e.player_id
   where e.season_id = v_season
     and e.kind = 'SQUAD'
     and p.user_id = (select auth.uid());

  if v_entry is null then
    raise exception 'No tenés lugar en esta temporada.';
  end if;

  insert into public.attendances (matchday_id, entry_id, season_id, discipline_id, status)
  values (p_matchday, v_entry, v_season, v_discipline, p_status)
  on conflict (matchday_id, entry_id) do update set status = excluded.status;
end;
$$;

revoke execute on function public.set_my_attendance(uuid, text) from public, anon;
grant  execute on function public.set_my_attendance(uuid, text) to authenticated;
