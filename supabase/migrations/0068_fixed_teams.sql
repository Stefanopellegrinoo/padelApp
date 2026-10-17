-- ── Equipos fijos: la disciplina donde la pareja no rota ─────────────────────
-- docs/tipos-de-torneo.md §1. Es lo ÚNICO de "tipos de torneo" que pide modelo
-- nuevo; el resto ya era configurable, o es superficie.
--
-- El motor NO se toca, y eso se midió antes de escribir esto:
-- `core/matchings.ts:22` (`if (pool.length === 0) return [[]]`, con test en
-- `core/matchings.test.ts:6`) ya hace que un pool ENTERO de parejas trabadas
-- salga sin sorteo. Y la regla de no repetir filtra el sorteo, así que una
-- pareja que nunca entra al sorteo nunca la toca. Lo único que falta es DÓNDE
-- viven los equipos.

-- ── disciplines.fixed_teams ─────────────────────────────────────────────────
-- Al lado de `pair_size` y `allows_draw`, y como ellos: **se fija al crear la
-- disciplina y no se edita**. Eso no hace falta escribirlo, ya es cierto: el
-- `revoke update` de `0015_disciplines.sql:69` deja a `authenticated` con
-- update SÓLO sobre `(config, weight, has_masters, position)`, así que una
-- columna nueva nace inmutable desde la API.
--
-- Es a propósito y no una omisión. Darla vuelta a mitad de temporada le cambia
-- el sentido a las fechas ya cerradas: las de antes se jugaron rotando y las
-- de después no, y la tabla suma las dos como si fueran lo mismo. El día que
-- alguien lo pida de verdad, es agregarla a ese grant — una línea, reversible.
-- Al revés (soltarla ahora y tener que atarla después) no es reversible.
alter table public.disciplines add column fixed_teams boolean not null default false;

-- ── discipline_teams ────────────────────────────────────────────────────────
-- `pair_locks` pero POR DISCIPLINA en vez de por fecha, que es toda la
-- diferencia entre "esta pareja no se toca hoy" y "estos dos son un equipo".
--
-- Deliberadamente NO es `pair_locks` con `matchday_id` nullable. Dos motivos
-- medidos:
--
--   1. `assertLocksAndGuests` (`db/validate.ts:205`) exige que toda pareja
--      trabada incluya a un invitado, y el motivo escrito en
--      `0001_schema.sql:122` es que dos del plantel trabados a mano saltearían
--      la regla de no repetir — que es JUSTO la que equipos fijos apaga a
--      propósito. Un equipo fijo violaría esa guarda por definición.
--   2. `promote_guest` borra locks en ocho migraciones (`0014`, `0023`,
--      `0025`, `0031`, `0032`, `0033`, `0048`, `0062`). Un equipo que viviera
--      ahí se borraría solo cuando un invitado asciende al plantel.
--
-- Viviendo aparte, ninguna de las dos cosas hay que tocarla.
create table public.discipline_teams (
  id            uuid primary key default gen_random_uuid(),
  discipline_id uuid not null,
  entry_a       uuid not null,
  entry_b       uuid not null,
  season_id     uuid not null,
  -- La mitad FIJA de una FK compuesta, mismo idioma que
  -- `discipline_entries.entry_kind` (`0023:21`): un equipo en una disciplina
  -- de a UNO no es un equipo raro, es una contradicción. El ancla que lo
  -- sostiene es `disciplines_size_anchor` (`0015`), que ya existe.
  pair_size     int not null default 2 check (pair_size = 2),
  created_at    timestamptz not null default now(),
  check (entry_a <> entry_b),
  -- Cubren la MITAD de "nadie en dos equipos": alguien podría estar como
  -- `entry_a` de uno y `entry_b` de otro. Esa mitad la valida el borde —
  -- misma limitación y misma respuesta que `pair_locks` (`0001:135`).
  unique (discipline_id, entry_a),
  unique (discipline_id, entry_b),
  foreign key (discipline_id, season_id) references public.disciplines (id, season_id) on delete cascade,
  foreign key (discipline_id, pair_size) references public.disciplines (id, pair_size),
  -- La garantía grande, y son DOS en una: apuntar a `discipline_entries`
  -- —cuya PK es `(discipline_id, entry_id)`, ancla directa sin índice extra—
  -- exige que cada mitad del equipo JUEGUE esta disciplina, y de paso que sea
  -- SQUAD, porque `discipline_entries.entry_kind` ya está clavado en 'SQUAD'.
  -- Un invitado no puede ser parte de un equipo fijo: los invitados son de una
  -- fecha y los equipos son de la temporada. Mismo patrón que
  -- `attendances_entry_discipline` (`0024:23`).
  foreign key (discipline_id, entry_a) references public.discipline_entries (discipline_id, entry_id) on delete cascade,
  foreign key (discipline_id, entry_b) references public.discipline_entries (discipline_id, entry_id) on delete cascade
);

create index discipline_teams_by_discipline on public.discipline_teams (discipline_id);

-- Sin este grant de tabla, tanto `authenticated` como `service_role` reciben
-- "permission denied for table discipline_teams": tabla NUEVA creada después
-- de `0002_rls.sql`, así que su blanket grant no la alcanzó (mismo gotcha que
-- `disciplines`, `0015:48-52`, y `discipline_entries`, `0023:51-55`).
grant select, insert, update, delete on public.discipline_teams to authenticated, service_role;

alter table public.discipline_teams enable row level security;
create policy discipline_teams_read on public.discipline_teams
  for select to authenticated using (public.is_participant(season_id));
create policy discipline_teams_write on public.discipline_teams
  for all to authenticated
  using (public.is_season_admin(season_id)) with check (public.is_season_admin(season_id));

-- Mismo motivo que `discipline_entries` (`0023:63-67`): tabla nueva, `anon` no
-- tiene ningún negocio acá, y sin el revoke hereda TRUNCATE, que no está
-- sujeto a RLS.
revoke all on public.discipline_teams from anon;
