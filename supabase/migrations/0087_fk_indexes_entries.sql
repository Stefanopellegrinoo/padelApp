-- ── Índices en las FKs que apuntan a `entries` ──────────────────────────────
-- Postgres indexa automáticamente la PK y los UNIQUE, pero NO el lado que
-- REFERENCIA de una foreign key. Siete FKs apuntaban a `public.entries` sin un
-- índice que empezara por su columna, así que cada `delete from entries`
-- disparaba un `Seq Scan` por cada una — de la tabla ENTERA del deployment, no
-- de la temporada.
--
-- Eso venía de antes y no molestaba a nadie: el delete de `removeSeat` no
-- sostenía ningún lock mientras escaneaba. **0086 lo cambió.** Desde esa
-- migración el delete corre adentro de la sección crítica del advisory lock
-- por temporada, así que ese tiempo de scan es tiempo exacto en el que
-- `add_squad_seat` y `promote_guest` de la MISMA temporada esperan detrás. El
-- arreglo de un deadlock se había convertido, sin querer, en un serializador
-- que escala con el tamaño de la base.
--
-- Medido en la local con 201.181 filas en `pairs` (una temporada de prueba con
-- volumen, borrada después), sondeando exactamente lo que hace el chequeo de
-- integridad referencial (`select 1 from pairs where entry_a = $1 for key
-- share`), con `explain (analyze, timing)`:
--
--   sin índice .... Seq Scan on pairs ............ 13,74 ms
--   con índice .... Index Scan using pairs_entry_a_idx ... 0,085 ms
--
-- ~160x sobre UNA de las siete FKs, con una tabla que en producción va a ser
-- mucho más grande que 200k.
--
-- El costo real del delete es esa diferencia multiplicada por las siete FKs, y
-- crece lineal con la tabla; el beneficio es que la sección crítica del
-- advisory deja de depender del tamaño del deployment.
--
-- Seis índices y no siete: las dos FKs de `attendances` comparten `entry_id`
-- como columna líder, así que un solo índice cubre a las dos. El invariante lo
-- custodia `dl.fk_sin_indice()` (`scripts/deadlock/fixture.sql`), que corre
-- como preflight del gate y aborta si aparece una FK nueva sin índice —
-- `pg_catalog` no está expuesto por PostgREST, así que desde vitest no es
-- alcanzable.
create index if not exists attendances_entry_id_idx on public.attendances (entry_id);
create index if not exists awards_entry_id_idx      on public.awards (entry_id);
create index if not exists pair_locks_entry_a_idx   on public.pair_locks (entry_a);
create index if not exists pair_locks_entry_b_idx   on public.pair_locks (entry_b);
create index if not exists pairs_entry_a_idx        on public.pairs (entry_a);
create index if not exists pairs_entry_b_idx        on public.pairs (entry_b);
