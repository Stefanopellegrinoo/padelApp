-- ── create_masters pasa a delegar en create_discipline_masters (C36) ───────
-- Archivo aparte de `0064` a propósito: la regla del repo es UNA función por
-- migración (`db/migrations.unit.test.ts`), y la lista de históricas con
-- varias es sólo para las que ya están en `schema_migrations` de producción y
-- no se pueden cambiar. Ésta no lo está.
--
-- `create_masters` NO se toca en su firma ni en sus grants: pasa a ser un
-- wrapper que resuelve la primaria con el mismo criterio de siempre y delega.
-- Así los dos caminos no pueden divergir — que es lo que pasó entre `0049` y
-- `0050` — y nada que hoy la llame se entera.
--
-- Después de esta tanda NO le queda un solo caller de producción (el wrapper
-- de `db/matchday.ts` llama a la nueva); los que quedan son los tests de
-- `db/write-screens.db.test.ts`, que la ejercitan por RPC directo. El CONTRACT
-- se la puede llevar con un `drop function public.create_masters(uuid, date)`
-- y esos tests.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_discipline uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select id into v_discipline
    from public.disciplines
   where season_id = p_season
   order by position, created_at
   limit 1;
  if v_discipline is null then
    raise exception 'La temporada no tiene disciplina.';
  end if;

  return public.create_discipline_masters(v_discipline, p_played_on);
end;
$$;
