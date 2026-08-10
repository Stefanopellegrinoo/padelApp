-- El estado de la fecha lo mueven las funciones y nadie más: la Task 6 revocó
-- `update (status)` a `authenticated` justamente para que un `PATCH` no pueda
-- saltear estos controles. Por eso `security definer`, y por eso arranca
-- preguntando si quien llama es el admin.

create or replace function public.open_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_status text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede abrir una fecha.';
  end if;

  select status into v_status from public.matchdays where id = p_matchday for update;
  if v_status <> 'DRAFT' then
    raise exception 'Esta fecha ya no está en armado.';
  end if;

  if not exists (select 1 from public.pairs where matchday_id = p_matchday) then
    raise exception 'Generá las parejas antes de abrir la fecha.';
  end if;

  update public.matchdays set status = 'OPEN' where id = p_matchday;

  -- La temporada arranca cuando se abre su primera fecha. Es el único lugar
  -- donde SETUP puede pasar a ACTIVE, así que la columna no queda muerta.
  update public.seasons set status = 'ACTIVE' where id = v_season and status = 'SETUP';
end;
$$;

revoke execute on function public.open_matchday(uuid) from public, anon;
grant  execute on function public.open_matchday(uuid) to authenticated;
