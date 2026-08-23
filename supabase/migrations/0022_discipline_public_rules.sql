--PR 5 (torneo-multi-disciplina, REQ-D2-1) ─────────────────────────────────
--
-- `season_public_rules` (0007_write_screens.sql:124) devolvía `s.config`, la
-- config de `seasons`. Desde 0015_disciplines.sql esa columna dejó de ser la
-- fuente real: `disciplines.config` es lo que `disciplineConfig`/
-- `updateDisciplineConfig` (db/discipline.ts, esta misma PR) leen y escriben,
-- y `seasons.config` queda en dual-write hasta el contract (PR 27) sin que
-- nadie más la actualice. Sin este cambio, la página de reglas —la ÚNICA
-- superficie pública, sin sesión— podía mostrarle a un extraño una config
-- vieja apenas alguien tocara Ajustes.
--
-- Misma firma, mismo `returns table`: nada del lado de PostgREST cambia.
-- Adentro, se resuelve la disciplina por defecto con el MISMO criterio que
-- `defaultDisciplineId` (db/season.ts) y `create_masters` (0021): `order by
-- position, created_at limit 1`. Hasta que haya wizard multi-disciplina
-- (PR 11) toda temporada tiene exactamente una, así que el `limit 1` no
-- descarta nada todavía — pero ya no hace falta reescribir esta función
-- cuando eso deje de ser cierto.
create or replace function public.season_public_rules(p_season uuid)
returns table (
  name             text,
  config           jsonb,
  rules_text       text,
  rules_updated_at timestamptz,
  admin_name       text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name,
         d.config,
         s.rules_text,
         s.rules_updated_at,
         coalesce(p.display_name, '')
    from public.seasons s
    join public.disciplines d on d.season_id = s.id
    left join public.players p on p.user_id = s.created_by
   where s.id = p_season
   order by d.position, d.created_at
   limit 1
$$;

-- Grants ya vivían para esta función (0007) y `create or replace` los
-- conserva; se repiten acá por explicitud, mismo idioma que 0019/0021.
revoke execute on function public.season_public_rules(uuid) from public;
grant  execute on function public.season_public_rules(uuid) to anon, authenticated;
