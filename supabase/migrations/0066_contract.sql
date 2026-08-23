-- ══ EL CONTRACT ══════════════════════════════════════════════════════════
-- Paso 11 del design #3801 (`secuencia_expand_contract`), y el ÚNICO paso
-- IRREVERSIBLE de toda la cadena `torneo-multi-disciplina`.
--
-- Retira las tres columnas que el EXPAND dejó vivas para que la migración
-- fuera rollbackeable. Cada una se dejó de escribir en su propia tanda, con
-- su par RED/GREEN, y recién acá se dropea:
--
--   * `seasons.config`  -- C35. Nullable desde `0059`.
--   * `seasons.status`  -- bloqueante #2. Sin escritor desde `0055`-`0058`.
--   * `entries.seed_position` PARA EL SQUAD -- C37. Nullable desde `0060`.
--
-- ── POR QUÉ VA TODO EN UNA MIGRACIÓN ────────────────────────────────────
-- No hay estado intermedio que aporte nada: dropear `config` sin dropear
-- `status` deja la misma deuda a medias, y las tres columnas se dejaron de
-- usar en el MISMO expand. La regla "una función por migración"
-- (`db/migrations.unit.test.ts`) no aplica: esto no define ninguna función.
--
-- ── LA EVIDENCIA, MEDIDA Y NO RAZONADA ──────────────────────────────────
-- Esta DDL exacta se aplicó TRES veces a la base local con la suite completa
-- corrida encima (patrón #4036, `verify-report-contract-go`):
--
--   1a vuelta: 324 rojos -> la factory de tests + 3 fixtures escribían config
--   2a vuelta:   9 rojos -> `supabase/seed.sql`, el último escritor vivo
--   3a vuelta:   8 rojos -> los 8 son TESTS-GUARDIA. Cero producción.
--
-- Los 8 leen o escriben estas columnas PARA PROBAR QUE NADIE MÁS LAS TOCA, y
-- se borran en este mismo commit:
--
--   db/season-status-writers.db.test.ts            (archivo entero, 4 tests)
--   db/read.db.test.ts        x2  (plantan una mentira en seasons.status)
--   db/entries.db.test.ts     x2  (guardias de C35 y de C37)
--
-- ── LO QUE NO SE LLEVA, A PROPÓSITO ─────────────────────────────────────
-- `create_masters(uuid, date)` quedó sin un solo caller de producción desde
-- C36 (`0065` la dejó delegando en `create_discipline_masters`), y podría
-- dropearse acá. NO se hace: el contract es sobre las COLUMNAS, y meterle una
-- limpieza de funciones al único paso irreversible agranda su superficie sin
-- necesidad. Es un `drop function` de una línea el día que se quiera.

-- ── 1. seasons.config ───────────────────────────────────────────────────
-- `disciplines.config` es la fuente real desde PR 5. El último lector de
-- producción se fue en `0049` (`create_masters` pasó a leer la disciplina) y
-- el último escritor en `ecc2359` (`createSeason`). El seed la escribía hasta
-- esta misma cadena — y no estaba en ninguna lista: apareció recién aplicando
-- el contract ENTERO, porque no es código de la app.
alter table public.seasons drop column config;

-- ── 2. seasons.status ───────────────────────────────────────────────────
-- REQ-D3-3: el estado de un torneo se DERIVA de `disciplines.status`
-- (`seasonStatusOf`). Las cuatro funciones de fechas dejaron de escribirla en
-- `0055`-`0058`, con un restatement quirúrgico cada una. Verificado por
-- catálogo: cero vistas, triggers, políticas, índices o FKs colgaban de esta
-- columna — sólo su propio CHECK, que se va con ella.
alter table public.seasons drop column status;

-- ── 3. entries.seed_position, sólo para el SQUAD ────────────────────────
-- La columna NO se dropea: para un GUEST sigue siendo su orden REAL dentro de
-- la fecha (`entries_guest_order`), lo escribe `addGuestSeat` y acá se le
-- exige `not null`. Lo que se retira es su uso para el plantel, que era una
-- réplica degradada desde PR 7 — el orden real vive en
-- `discipline_entries.seed_position`, POR DISCIPLINA, y el orden a nivel
-- TORNEO es el de la disciplina primaria (decisión #4044).
--
-- `entries_seed` era unique `(season_id, seed_position) where kind = 'SQUAD'`:
-- sin filas SQUAD con valor, no protege nada.
drop index public.entries_seed;

update public.entries set seed_position = null where kind = 'SQUAD';

-- El CHECK ata la forma a `kind` en vez de dejar la columna "nullable y ya":
-- un SQUAD con `seed_position` vuelve a ser un ERROR DE LA BASE, no una
-- degradación silenciosa. Es lo que convierte "nadie la escribe" en "nadie
-- la puede escribir".
alter table public.entries add constraint entries_seed_shape check (
  (kind = 'GUEST' and seed_position is not null) or
  (kind = 'SQUAD' and seed_position is null)
);
