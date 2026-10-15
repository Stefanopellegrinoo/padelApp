-- docs/plan-torneos-deportes.md (Tarea 7), docs/torneos-deportes.md §6 y §9: la
-- página Reglas, pública y sin cuenta, cuenta cada deporte "en criollo" con la
-- MISMA función que el wizard (`reglamento`), y esa frase necesita dos reglas de
-- juego más que `season_public_formats` no devolvía: si la pareja rota o es fija
-- (`fixed_teams`) y cómo se arma cada fecha (`formato_default`).
--
-- UNA función, mismo drop+create que 0069: agregar columnas cambia el tipo de
-- `returns table`, que Postgres rechaza en un `create or replace`, y el drop se
-- lleva los grants — por eso se re-otorgan abajo (sin ese par, la única
-- superficie pública del sistema queda sin permiso para `anon`).
--
-- El criterio de 0069 sigue siendo el que decide qué sale: ESTRUCTURA INTERNA se
-- queda adentro; REGLAS DE JUEGO salen. Las dos columnas nuevas son reglas de
-- juego, de la misma familia que `pair_size` o `matchFormat` de `config`, que
-- `anon` ya recibe. Nada de identidad: `id`, `season_id`, `status`, `weight`,
-- `position` y `created_at` siguen afuera.
drop function if exists public.season_public_formats(uuid);

create function public.season_public_formats(p_season uuid)
returns table (
  kind            text,
  config          jsonb,
  rules_text      text,
  has_masters     boolean,
  pair_size       int,
  allows_draw     boolean,
  fixed_teams     boolean,
  formato_default jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.kind, d.config, d.rules_text, d.has_masters, d.pair_size, d.allows_draw,
         d.fixed_teams, d.formato_default
    from public.disciplines d
   where d.season_id = p_season
   order by d.position, d.created_at
$$;

revoke execute on function public.season_public_formats(uuid) from public;
grant  execute on function public.season_public_formats(uuid) to anon, authenticated;
