-- ── superficie de `disciplines` para `anon` y `authenticated` ───────────────
-- Tres hallazgos de la auditoría de la Fase 0 (verify-report), los tres sobre
-- privilegios de tabla/función — nada de RLS ni de lógica.

-- ── W1 — `disciplines` es la ÚNICA de las 11 tablas con ACL para `anon` ─────
-- Medido (information_schema): `disciplines | anon | MAINTAIN, REFERENCES,
-- TRIGGER, TRUNCATE`. Las otras diez tablas: ninguno. Esos privilegios NO
-- salen de ningún grant explícito de este schema — Postgres se los da a
-- PUBLIC (y por herencia a `anon`) al crear la tabla, salvo que se revoquen.
-- `0009_anon_surface.sql:26` (`revoke all on all tables in schema public
-- from anon`) ya hizo ese revoke, pero es puntual en el tiempo: sólo alcanzó
-- a las tablas que existían cuando corrió. `disciplines` nació después
-- (0015) y quedó afuera — el mismo agujero que el grant blanket de 0002
-- dejaba, que el propio 0015 sí compensó para `select/insert/update/delete`.
--
-- `TRUNCATE` no está sujeto a RLS y hoy no es alcanzable por PostgREST (no
-- expone el verbo), pero ese es justo el argumento de "una sola línea de
-- defensa" que 0009 escribió para rechazar.
--
-- MISMO PENDIENTE para `discipline_entries` (PR 7) y `award_lines` (PR 25):
-- cualquier tabla nueva creada después de 0009 nace con esta ACL de PUBLIC
-- todavía puesta. Su propia migración necesita este mismo `revoke`, no
-- asumir que alcanza con no otorgarle nada a mano.
revoke all on public.disciplines from anon;

-- ── W2 — `authenticated` podía INSERTAR `disciplines.status` aunque el
-- UPDATE ya esté revocado (0015:69-70) ───────────────────────────────────────
-- Medido (information_schema.column_privileges):
-- `disciplines | authenticated | INSERT | status` (ídem kind, pair_size,
-- allows_draw). El revoke de UPDATE de 0015 cierra el PATCH; el INSERT de
-- 0015:52 (`grant select, insert, update, delete on public.disciplines to
-- authenticated, service_role`) sigue siendo a nivel TABLA, sobre TODAS las
-- columnas — un admin de temporada puede crear una disciplina ya en
-- ACTIVE/FINISHED por PostgREST. Mismo agujero que 0002_rls.sql:230-238
-- cerró para `matchdays.status`, acá sin cerrar. Precedente que se sigue acá,
-- columna por columna: (season_id, kind, config, weight, pair_size,
-- allows_draw, has_masters, position) — todo lo que `createSeason`
-- (db/season.ts) y el futuro `addDiscipline` (PR 13) necesitan mandar, sin
-- `status` ni `id`/`created_at` (tienen default, no los manda el caller).
--
-- Inerte hoy: nada lee `disciplines.status` desde la app todavía. Vivo en
-- cuanto exista `addDiscipline`.
revoke insert on public.disciplines from authenticated;
grant  insert (season_id, kind, config, weight, pair_size, allows_draw, has_masters, position)
  on public.disciplines to authenticated;

-- ── W5 — `matchday_discipline()` es código muerto expuesto como RPC ─────────
-- Grep: 0 consumidores de producción, 0 policies de RLS que la usen. PR 4
-- (0018) deliberadamente NO la llamó: `reopen_matchday`/`cancel_matchday`
-- leen `discipline_id` del MISMO `select ... for update` que ya bloquea la
-- fila (más seguro, cero ventana de raza nueva) — decisión correcta, pero
-- dejó la función con `grant execute ... to authenticated` sin ningún uso,
-- expuesta como `/rest/v1/rpc/matchday_discipline`. Mismo criterio con el
-- que 0009 revocó `handle_new_user`: no hay una sola razón para que figure
-- en la API pública. Se revoca, no se dropea: sigue disponible para quien la
-- necesite (mismo rol que `matchday_season`, que si tiene 20+ consumidores
-- en policies de RLS y por eso conserva su grant).
revoke execute on function public.matchday_discipline(uuid) from public, anon, authenticated;
