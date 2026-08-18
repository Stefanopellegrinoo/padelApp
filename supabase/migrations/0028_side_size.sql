-- PR 14 slice C (torneo-multi-disciplina, REQ-D5-1) ────────────────────────
--
-- La BASE, no un `if` de aplicación, tiene que rechazar `pairs.entry_b` no
-- nulo si `pair_size=1`, y nulo si `pair_size=2`. Hoy `pairs.entry_b` es
-- `uuid not null` (0001_schema.sql:158) y nada en el schema sabe que una
-- disciplina puede ser de a uno (`disciplines.pair_size`, 0015) — esta
-- migración cierra esa distancia con la MISMA cadena de FK compuestas que
-- ya trae `discipline_id` (0015/0016): `disciplines` → `matchdays` → `pairs`,
-- denormalizada un salto a la vez.
--
-- Expand/contract: `pairs` tiene datos de producción (PnP-1000), así que sus
-- dos constraints nuevas nacen `not valid` acá y se validan en un archivo
-- SEPARADO (0029) — mismo criterio que `secuencia_expand_contract` del
-- design (#3801): en el MISMO archivo el patrón es decorativo, un scan
-- completo de tabla no puede correr adentro de la transacción de otro
-- `alter table`. `matchdays` no tiene ese volumen (una fecha por temporada
-- por número), así que su FK nueva se valida directo, sin partir el archivo.

-- ── matchdays.pair_size ──────────────────────────────────────────────────
alter table public.matchdays add column pair_size int not null default 2 check (pair_size in (1, 2));
-- Backfill desde la disciplina REAL de cada fecha, no un literal: una fecha
-- ya pudo haber nacido bajo una disciplina pair_size=1 (PR14 slice A/B ya
-- permiten crearla) antes de que existiera esta columna.
update public.matchdays m set pair_size = d.pair_size
  from public.disciplines d where d.id = m.discipline_id;
-- `on update no action` (default): con fechas ya creadas, la disciplina NO
-- puede cambiar de tamaño de lado. Lo rechaza la base, no un `if` de app.
alter table public.matchdays add constraint matchdays_discipline_size
  foreign key (discipline_id, pair_size) references public.disciplines (id, pair_size);
-- Ancla para que `pairs` pueda atar su propio `pair_size` a la fecha con una
-- FK compuesta, mismo idioma que `matchdays_discipline_anchor` (0016).
alter table public.matchdays add constraint matchdays_size_anchor unique (id, pair_size);
-- MISMO GOTCHA que `discipline_id` (0015) y `allows_draw`/`formato` (por
-- venir): `matchdays` tiene column-grant explícito (0002_rls.sql:236-238) —
-- sin este grant, createMatchday (db/matchday.ts) falla con "permission
-- denied for table matchdays" al intentar escribir esta columna nueva.
grant insert (pair_size) on public.matchdays to authenticated;

-- ── pairs.entry_b nullable + pairs.pair_size + pairs_side_shape ────────────
-- `check (entry_a <> entry_b)` (0001:159) NO se toca: con `entry_b is null`
-- da NULL, y un CHECK con NULL pasa (no lo viola). La FK de `entry_b` contra
-- `entries (id, season_id)` (0001:171) tampoco: MATCH SIMPLE (el default de
-- Postgres) la satisface con cualquier columna en null.
alter table public.pairs alter column entry_b drop not null;
alter table public.pairs add column pair_size int not null default 2;
update public.pairs p set pair_size = m.pair_size
  from public.matchdays m where m.id = p.matchday_id;

alter table public.pairs add constraint pairs_matchday_size
  foreign key (matchday_id, pair_size) references public.matchdays (id, pair_size) not valid;
alter table public.pairs add constraint pairs_side_shape check (
  (pair_size = 1 and entry_b is null) or (pair_size = 2 and entry_b is not null)
) not valid;
