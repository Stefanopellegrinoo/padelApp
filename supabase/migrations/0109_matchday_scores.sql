-- ── Bowling: la fecha por ranking (odd/tasks/mas-deportes.md, T3, S4) ─────────
-- Una fecha `RANKING` no tiene partidos: cada presente carga su total ("no
-- sería sólo poner el total final que hizo cada uno, entonces el que más hizo
-- ganó y para abajo"). Esta migración trae el lugar donde se guarda ese total y
-- deja que `formato` diga `RANKING`. Abrir (0110) y cerrar (0111) van cada una
-- en su archivo: una función por migración (`db/migrations.unit.test.ts`).
--
-- Seguro para los datos que ya existen: los CHECK se ensanchan (todo lo que
-- pasaba sigue pasando) y los dos nuevos sólo miran filas `RANKING`, que hasta
-- acá no podían existir. La tabla nace vacía.

-- ── `formato`: un kind más ──────────────────────────────────────────────────
-- Mismo CASE anidado de 0095, más `RANKING`. `drop constraint` sin `if exists`:
-- si un nombre estuviera mal, que falle fuerte.
alter table public.disciplines
  drop constraint disciplines_formato_default_kind,
  add constraint disciplines_formato_default_kind check (
    case formato_default ->> 'kind'
      when 'AUTO' then true
      when 'ROUND_ROBIN' then true
      when 'RANKING' then true
      when 'GROUPS_KNOCKOUT' then
        case
          when (formato_default ->> 'groups') ~ '^[0-9]+$'
           and (formato_default ->> 'qualifiersPerGroup') ~ '^[0-9]+$'
          then (formato_default ->> 'groups')::int in (2, 4)
           and (formato_default ->> 'qualifiersPerGroup')::int = 2
          else false
        end
      else false
    end),
  -- Bowling se juega individual (decisión del orquestador): en una fecha de
  -- pinos no hay parejas. Sin esto, una disciplina de a dos por ranking
  -- llegaría a una fecha cuyo plantel no se puede pagar por pareja.
  add constraint disciplines_ranking_individual check (formato_default ->> 'kind' <> 'RANKING' or pair_size = 1);

alter table public.matchdays
  drop constraint matchdays_formato_kind,
  add constraint matchdays_formato_kind check (
    case formato ->> 'kind'
      when 'AUTO' then true
      when 'ROUND_ROBIN' then true
      when 'RANKING' then true
      when 'GROUPS_KNOCKOUT' then
        case
          when (formato ->> 'groups') ~ '^[0-9]+$'
           and (formato ->> 'qualifiersPerGroup') ~ '^[0-9]+$'
          then (formato ->> 'groups')::int in (1, 2, 4)
           and (formato ->> 'qualifiersPerGroup')::int = 2
          else false
        end
      else false
    end),
  add constraint matchdays_ranking_individual check (formato ->> 'kind' <> 'RANKING' or pair_size = 1);

-- ── matchday_scores ─────────────────────────────────────────────────────────
-- Una fila por (fecha, asiento): el total de ESA persona en ESA fecha. La
-- tabla del día NO se guarda —igual que con `match_sets`, se recalcula de acá
-- cada vez— y los puntos quedan congelados en `awards` al cerrar.
create table public.matchday_scores (
  matchday_id uuid not null,
  entry_id    uuid not null,
  season_id   uuid not null,
  -- "Sano" y no el máximo de un deporte: una línea de bowling llega a 300, y
  -- una serie de varias líneas sumadas pasa de mil. 9999 deja entrar cualquier
  -- total real y frena un dedo de más.
  score       int  not null constraint matchday_scores_score_range check (score between 0 and 9999),
  updated_at  timestamptz not null default now(),
  primary key (matchday_id, entry_id),
  -- La fecha del total tiene que ser de la MISMA temporada que el total (mismo
  -- idioma que `attendances`/`awards`, 0001). Borrar la fecha se lo lleva.
  foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade,
  -- `no action`, como `awards` y `pairs`: dar de baja a alguien no puede
  -- borrar los pinos de una fecha que ya se cerró. Se verifica al final de la
  -- sentencia, así que borrar la temporada entera sigue funcionando.
  foreign key (entry_id, season_id) references public.entries (id, season_id) on delete no action
);
-- El FK de `entry_id` necesita su índice para que borrar un asiento no recorra la tabla (0087).
create index matchday_scores_entry_id_idx on public.matchday_scores (entry_id);

-- ── quién puede escribir un total ───────────────────────────────────────────
-- Definer, como `match_is_open` (0002) y por el mismo motivo: que la política
-- no dependa de la RLS de `matchdays`/`attendances`. Una sola pregunta: ¿esta
-- fecha es por ranking, está EN JUEGO, y este asiento vino? En DRAFT todavía
-- se está decidiendo quién juega; en CLOSED los puntos ya están congelados y un
-- total nuevo dejaría la tabla diciendo una cosa y `awards` otra.
create or replace function public.matchday_score_is_open(p_matchday uuid, p_entry uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.matchdays m
      join public.attendances a on a.matchday_id = m.id
     where m.id = p_matchday
       and m.status = 'OPEN'
       and m.formato ->> 'kind' = 'RANKING'
       and a.entry_id = p_entry
       and a.status = 'PLAYING'
  )
$$;

-- Mismo motivo que en 0002 y 0089: sin sacarle el grant a PUBLIC, cualquiera
-- sin cuenta la ejecuta por PostgREST.
revoke execute on function public.matchday_score_is_open(uuid, uuid) from public, anon;
grant  execute on function public.matchday_score_is_open(uuid, uuid) to authenticated;

-- Tabla nueva después del grant blanket de 0002: el mismo gotcha que
-- `award_lines` (0047). Sin esto, `authenticated` y `service_role` reciben
-- "permission denied" antes de que la RLS llegue a opinar.
grant select, insert, update, delete on public.matchday_scores to authenticated, service_role;
revoke all on public.matchday_scores from anon;

alter table public.matchday_scores enable row level security;

create policy matchday_scores_read on public.matchday_scores
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

-- El espejo de `match_sets_write` (0089): quien organiza, o un participante
-- con "los jugadores cargan los resultados" prendido. `matchday_score_is_open`
-- sale al frente, como `match_is_open` allá: el permiso amplía QUIÉN escribe,
-- nunca CUÁNDO.
create policy matchday_scores_write on public.matchday_scores
  for all to authenticated
  using (
    public.matchday_score_is_open(matchday_id, entry_id)
    and (
      public.is_season_admin(public.matchday_season(matchday_id))
      or (
        public.is_participant(public.matchday_season(matchday_id))
        and public.players_can_score(public.matchday_season(matchday_id))
      )
    )
  )
  with check (
    public.matchday_score_is_open(matchday_id, entry_id)
    and (
      public.is_season_admin(public.matchday_season(matchday_id))
      or (
        public.is_participant(public.matchday_season(matchday_id))
        and public.players_can_score(public.matchday_season(matchday_id))
      )
    )
  );
