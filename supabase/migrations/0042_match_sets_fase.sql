-- PR21 tanda de cierre (torneo-multi-disciplina, C30 + decisión #4005) ──────
--
-- Decisión de Stefano (#4005, sobre el hallazgo C30 de verify-report-pr21
-- #4004): el empate es LEGAL sólo en la fase de GRUPO. En OCTAVOS/CUARTOS/
-- SEMI/TERCER_PUESTO/FINAL queda PROHIBIDO por la BASE -- un constraint, no
-- un `if` de aplicación. Causa raíz que este constraint cierra:
-- `phaseIsComplete` ("tiene sets cargados") y `winnerOf` ("tiene un
-- ganador") no acordaban qué es un partido resuelto -- con el empate
-- prohibido fuera de GRUPO, las dos definiciones vuelven a coincidir: un
-- partido con sets SIEMPRE tiene ganador ahí.
--
-- Mismo idioma que `match_sets_no_draw` (0034/0035) y la misma cadena de FK
-- compuestas denormalizadas que el design (#3801) usa para `allows_draw` y
-- `pair_size`: `fase` baja de `matches` a `match_sets` para que el check
-- pueda mirarla. Necesita el ancla `unique (id, fase)` en `matches`, que no
-- existía todavía (0039 sólo agregó la columna, sin ancla: nada la
-- necesitaba hasta ahora).
--
-- Expand/contract: `match_sets` tiene datos de producción (PnP-1000), mismo
-- criterio que 0034/0035 -- las dos constraints nuevas nacen `not valid`
-- acá y se validan en un archivo separado (0043). `matches_fase_anchor` es
-- un ÍNDICE ÚNICO, no un check: no existe `not valid` para eso, y
-- `create index concurrently` es ILEGAL en este archivo (el CLI de Supabase
-- corre cada migración en una transacción, 25001) -- mismo costo que ya se
-- aceptó para `matches_draw_anchor`/`matches_size_anchor` (0028/0034):
-- `matches` está lejos del umbral donde ese lock importa.

alter table public.matches add constraint matches_fase_anchor unique (id, fase);

alter table public.match_sets add column fase text not null default 'GRUPO'
  check (fase in ('GRUPO', 'OCTAVOS', 'CUARTOS', 'SEMI', 'TERCER_PUESTO', 'FINAL'));
update public.match_sets s set fase = m.fase
  from public.matches m where m.id = s.match_id;
alter table public.match_sets add constraint match_sets_match_fase
  foreign key (match_id, fase) references public.matches (id, fase) on delete cascade not valid;

-- El check de 0034/0035 sólo miraba `allows_draw`. Se dropea y se reemplaza
-- por la versión que TAMBIÉN mira `fase`: con `fase = 'GRUPO'` es
-- LITERALMENTE el check anterior, palabra por palabra; fuera de GRUPO, un
-- empate queda prohibido aunque `allows_draw` sea `true`. Lógica de tres
-- valores: `fase`/`allows_draw` son `not null` acá, así que ninguno de los
-- dos `and`/`or` tiene una rama NULL que evaluar.
alter table public.match_sets drop constraint match_sets_no_draw;
alter table public.match_sets add constraint match_sets_no_draw
  check (games_a <> games_b or (allows_draw and fase = 'GRUPO')) not valid;
