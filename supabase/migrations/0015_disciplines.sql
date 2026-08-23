-- ── disciplines ──────────────────────────────────────────────────────────────
-- Un torneo hoy es una sola disciplina (pádel). Esta tabla es el fundamento
-- para que sea 1+ (spec D1): cada disciplina es su propia fila, con su propia
-- config, su propio calendario y su propio estado — todo lo que hoy vive
-- suelto en `seasons`.
--
-- `pair_size`, `allows_draw` y `has_masters` ya están acá aunque nada los lea
-- todavía (llegan en PR 13/19/20): las anclas `unique (id, pair_size)` y
-- `unique (id, allows_draw)` las necesita `matchdays` para sus FK compuestas
-- cuando denormalice esos valores, y crearlas ahora evita una migración
-- separada sólo para agregarlas después.
create table public.disciplines (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references public.seasons on delete cascade,
  kind         text not null check (kind in ('PADEL', 'FIFA')),
  config       jsonb not null,
  status       text not null default 'SETUP' check (status in ('SETUP', 'ACTIVE', 'FINISHED')),
  weight       numeric(4, 2) not null default 1 check (weight >= 0),
  pair_size    int not null default 2 check (pair_size in (1, 2)),
  allows_draw  boolean not null default false,
  has_masters  boolean not null default true,
  position     int not null default 0 check (position >= 0),
  created_at   timestamptz not null default now(),
  constraint disciplines_season_anchor unique (id, season_id),
  constraint disciplines_size_anchor   unique (id, pair_size),
  constraint disciplines_draw_anchor   unique (id, allows_draw)
);

create index disciplines_by_season on public.disciplines (season_id, position);

-- Backfill: cada temporada existente nace con exactamente una disciplina
-- PADEL que hereda su config y su estado. Es un select-insert 1:1 sin join
-- que pueda multiplicar filas, así que REQ-NR-4 ("toda temporada tiene al
-- menos una disciplina") queda cierto por construcción, sin verificación
-- aparte.
insert into public.disciplines (season_id, kind, config, status, position)
select id, 'PADEL', config, status, 0 from public.seasons;

-- TRIPWIRE: mientras este índice exista, una temporada NO puede tener una
-- segunda disciplina — a propósito. `reopen_matchday` y `cancel_matchday`
-- (0005/0012) todavía filtran por `season_id`, y con dos disciplinas
-- concurrentes eso las rompe (spec D4). Su `drop` vive en el MISMO archivo
-- que el arreglo de esas dos funciones (0018_reopen_cancel_scoped.sql): no
-- puede existir un estado intermedio donde el índice ya deja pasar una
-- segunda disciplina pero las funciones todavía asumen una sola.
create unique index disciplines_one_per_season on public.disciplines (season_id);

-- Sin este grant de tabla, tanto `authenticated` como `service_role` reciben
-- "permission denied for table disciplines": esta versión del CLI de
-- Supabase no le da DML a los roles de la API por default (0002_rls.sql:104-118),
-- y ese grant sólo alcanzó a las tablas que ya existían cuando corrió.
grant select, insert, update, delete on public.disciplines to authenticated, service_role;

alter table public.disciplines enable row level security;

create policy disciplines_read on public.disciplines
  for select to authenticated using (public.is_participant(season_id));

create policy disciplines_write on public.disciplines
  for all to authenticated
  using (public.is_season_admin(season_id))
  with check (public.is_season_admin(season_id));

-- Mismo motivo que 0002_rls.sql:230-238: PostgREST no distingue qué columna
-- se actualizó, así que un PATCH sobre `status` saltearía los controles que
-- van a vivir en las funciones que lo mueven. `kind`, `season_id` y
-- `pair_size`/`allows_draw` quedan afuera del update: son identidad y forma,
-- se fijan al crear la disciplina y no se editan.
revoke update on public.disciplines from authenticated, anon;
grant  update (config, weight, has_masters, position) on public.disciplines to authenticated;

-- ── matchdays.discipline_id ──────────────────────────────────────────────────
-- Nullable a propósito: expand antes que contract. `matchdays_discipline_season`
-- ya puede crearse con la columna en null porque MATCH SIMPLE (el default de
-- una FK compuesta) la da por satisfecha cuando cualquiera de las dos partes
-- es null.
alter table public.matchdays add column discipline_id uuid;

update public.matchdays m set discipline_id = d.id
  from public.disciplines d where d.season_id = m.season_id;

alter table public.matchdays add constraint matchdays_discipline_season
  foreign key (discipline_id, season_id) references public.disciplines (id, season_id) on delete cascade;

-- Sin esto: "permission denied for table matchdays" al crear una fecha como
-- `authenticated` en cuanto el código empiece a mandar `discipline_id`
-- (PR 2). Mismo gotcha que el grant de `disciplines` de arriba, pero a nivel
-- columna (0002_rls.sql:237 ya hace esto mismo para season_id/number/played_on).
grant insert (discipline_id) on public.matchdays to authenticated;
