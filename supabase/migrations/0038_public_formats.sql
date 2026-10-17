-- S76 / la mitad ANÓNIMA de W64: la página pública de Reglas narra UN SOLO
-- formato aunque el torneo tenga dos.
--
-- `season_public_rules` (0022) devuelve la config de la disciplina POR DEFECTO
-- —`order by position, created_at limit 1`— y ni siquiera su `kind`. Con eso,
-- un torneo de pádel + FIFA le dice a un extraño "1 set a 4 games" sobre una
-- mitad que se juega a goles. Medido en Chromium, rondas 22 y 23.
--
-- ── POR QUÉ UNA FUNCIÓN NUEVA Y NO UN `create or replace` DE LA VIEJA ───────
--
-- Porque no se puede: agregarle una columna al `returns table` de
-- `season_public_rules` cambia su tipo de retorno, y eso Postgres lo rechaza
-- —medido: `ERROR: cannot change return type of existing function ... Use DROP
-- FUNCTION first`—. Y un `drop` + `create` se lleva los grants y abre una
-- ventana de despliegue en la que la ÚNICA superficie pública del sistema no
-- existe: entre el drop y el grant, todo link compartido devuelve error.
--
-- Así que esto es ADITIVO. `season_public_rules` no se toca ni una letra y
-- sigue sirviendo lo que siempre sirvió; la página hace un segundo RPC.
--
-- ── LO QUE DEVUELVE, Y POR QUÉ NADA MÁS ────────────────────────────────────
--
-- `kind` y `config`. NO un `d.id`, NO un `returns setof public.disciplines`.
-- `anon` está detrás de `revoke all on all tables` (0009) —medido: lee 0
-- tablas y ejecuta 1 función—, así que cualquier columna de más acá es una
-- fuga: `id` regala claves primarias, y `pair_size`, `allows_draw`,
-- `has_masters`, `weight`, `status` y `season_id` son estructura interna del
-- torneo que un extraño con un link no tiene por qué ver.
--
-- `config` ya se expone hoy por `season_public_rules` para la disciplina por
-- defecto, así que esto no abre una clase de dato nueva: abre las MISMAS
-- columnas para las demás filas.
--
-- El orden es el canónico de esta cadena, el mismo de `defaultDisciplineId`
-- (db/season.ts), `create_masters` (0021) y `season_public_rules` (0022):
-- `order by position, created_at`. Sin `limit 1`, que es justamente el punto.
create or replace function public.season_public_formats(p_season uuid)
returns table (
  kind   text,
  config jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.kind, d.config
    from public.disciplines d
   where d.season_id = p_season
   order by d.position, d.created_at
$$;

-- Mismo idioma que 0019/0021/0022: `revoke` de `public` y grant explícito.
-- `anon` la necesita porque ésta es la pantalla que se comparte por link sin
-- login; `authenticated` también, para que la rama con sesión pueda usarla el
-- día que le sirva.
revoke execute on function public.season_public_formats(uuid) from public;
grant  execute on function public.season_public_formats(uuid) to anon, authenticated;
