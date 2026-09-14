-- ── el permiso "los jugadores cargan los resultados" ─────────────────────────
-- Lo prende el admin en Ajustes, y abre UNA escritura: los sets de un partido
-- de una fecha EN JUEGO. Abrir, cerrar y reabrir la fecha, el formato, las
-- reglas y el plantel siguen siendo del admin — no se toca ni una de sus
-- políticas acá abajo, y eso es el diseño, no un olvido.
--
-- Apagado por default: los torneos que ya existen quedan exactamente como
-- estaban, sin que nadie tenga que ir a apagar nada.
alter table public.seasons
  add column players_can_score boolean not null default false;

-- Definer, como las cinco helpers de 0002 y por el mismo motivo: que no dependa
-- de las políticas de la tabla que consulta. `seasons_read` hoy deja ver la
-- fila a todo participante, así que un `exists` crudo sobre `public.seasons`
-- daría lo mismo — pero ahí el "soy del torneo" quedaría dicho por la RLS de
-- OTRA tabla, y el día que `seasons_read` se angoste esta política se rompe
-- sola y en silencio. Acá el permiso pregunta una cosa sola: ¿está prendido?
create or replace function public.players_can_score(p_season uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.players_can_score from public.seasons s where s.id = p_season),
    false
  )
$$;

-- Postgres le da EXECUTE a PUBLIC en toda función nueva, y Supabase además
-- tiene default privileges para anon (0002): sin este revoke, cualquiera sin
-- cuenta la ejecuta por PostgREST y se entera de la configuración de un torneo
-- que no puede ni ver.
revoke execute on function public.players_can_score(uuid) from public, anon;
grant  execute on function public.players_can_score(uuid) to authenticated;

-- ── la única política que cambia ─────────────────────────────────────────────
-- `match_sets_write` (0002) pedía `is_season_admin` a secas. Ahora acepta
-- también al participante, pero sólo con el permiso prendido.
--
-- `match_is_open` no se afloja ni un poco, y sale al frente de la condición
-- para que se lea primero: en una fecha CLOSED los awards ya están congelados,
-- y un resultado nuevo deja la tabla diciendo una cosa y los puntos otra sin
-- que nada falle. Ese era el motivo en 0002 y sigue intacto — el permiso
-- amplía QUIÉN escribe, nunca CUÁNDO.
drop policy match_sets_write on public.match_sets;

create policy match_sets_write on public.match_sets
  for all to authenticated
  using (
    public.match_is_open(match_id)
    and (
      public.is_season_admin(public.match_season(match_id))
      or (
        public.is_participant(public.match_season(match_id))
        and public.players_can_score(public.match_season(match_id))
      )
    )
  )
  with check (
    public.match_is_open(match_id)
    and (
      public.is_season_admin(public.match_season(match_id))
      or (
        public.is_participant(public.match_season(match_id))
        and public.players_can_score(public.match_season(match_id))
      )
    )
  );
