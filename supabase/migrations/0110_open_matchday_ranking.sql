-- ── open_matchday abre una fecha por ranking sin parejas (bowling, S4) ──────
-- Restatement de la ÚLTIMA versión (`0055_open_matchday_no_season_status_write.sql`,
-- la única función de ese archivo), byte a byte salvo una rama: una fecha
-- `RANKING` no arma parejas —cada presente carga su total en
-- `matchday_scores` (0109)—, así que en vez de exigir parejas exige al menos
-- dos presentes. Para cualquier otro `formato` el chequeo y el mensaje son los
-- de siempre.
create or replace function public.open_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_status     text;
  v_formato    jsonb;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede abrir una fecha.';
  end if;

  select discipline_id, status, formato into v_discipline, v_status, v_formato
    from public.matchdays where id = p_matchday for update;
  if v_status <> 'DRAFT' then
    raise exception 'Esta fecha ya no está en armado.';
  end if;

  if v_formato ->> 'kind' = 'RANKING' then
    -- Con uno solo no hay ranking: ganaría sin competir.
    if (select count(*) from public.attendances
         where matchday_id = p_matchday and status = 'PLAYING') < 2 then
      raise exception 'Hacen falta al menos dos presentes para abrir la fecha.';
    end if;
  elsif not exists (select 1 from public.pairs where matchday_id = p_matchday) then
    raise exception 'Generá las parejas antes de abrir la fecha.';
  end if;

  update public.matchdays set status = 'OPEN' where id = p_matchday;

  -- El mismo trinquete, a nivel disciplina: su propio calendario es el que
  -- arranca, no el de sus hermanas. `seasons.status` ya no se toca acá.
  update public.disciplines set status = 'ACTIVE' where id = v_discipline and status = 'SETUP';
end;
$$;

revoke execute on function public.open_matchday(uuid) from public, anon;
grant  execute on function public.open_matchday(uuid) to authenticated;
