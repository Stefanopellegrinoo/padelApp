-- PR 20 rebanada A (torneo-multi-disciplina, REQ-D6-1) ─────────────────────
--
-- Persistir un partido empatado sólo si `disciplines.allows_draw = true`;
-- seguir rechazándolo si es `false`. `match_sets` sólo conoce `match_id`, así
-- que `allows_draw` viaja `disciplines → matchdays → matches → match_sets`,
-- MISMA cadena de FK compuestas que ya trae `pair_size` (0028/0029) —
-- `disciplines.allows_draw` y su ancla `disciplines_draw_anchor` ya existen
-- desde 0015, esta migración sólo agrega los tres saltos que faltan.
--
-- Decisión #13 del design (#3801): NO se dropea `match_sets_no_draw` para
-- validar en la app — eso borra una garantía que hoy protege producción. Se
-- la CONDICIONA: `check (allows_draw or games_a <> games_b)`. Con
-- `allows_draw = false` es LITERALMENTE el check viejo, palabra por palabra.
--
-- A diferencia de 0028 (pair_size), acá no hace falta un guard de deploy: el
-- check `match_sets_no_draw` viejo (`games_a <> games_b`, sin condición)
-- estuvo SIEMPRE activo — no hay ninguna ventana en la que un empate haya
-- podido colarse en `match_sets` antes de esta migración, así que el
-- backfill de `allows_draw` (siempre `false` en producción hoy) no puede
-- toparse con una fila que ya lo viole.
--
-- Expand/contract: `match_sets` tiene datos de producción (PnP-1000), así que
-- sus dos constraints nuevas nacen `not valid` acá y se validan en un
-- archivo SEPARADO (0035) — mismo criterio que `secuencia_expand_contract`
-- del design: en el MISMO archivo el patrón es decorativo. `matchdays` y
-- `matches` no tienen ese volumen, así que sus FKs nuevas se validan directo.

-- ── matchdays.allows_draw ────────────────────────────────────────────────
alter table public.matchdays add column allows_draw boolean not null default false;
update public.matchdays m set allows_draw = d.allows_draw
  from public.disciplines d where d.id = m.discipline_id;
-- `on update no action` (default): con fechas ya creadas, la disciplina NO
-- puede cambiar si permite empate. Lo rechaza la base, no un `if` de app.
alter table public.matchdays add constraint matchdays_discipline_draw
  foreign key (discipline_id, allows_draw) references public.disciplines (id, allows_draw);
-- Ancla para que `matches` pueda atar su propio `allows_draw` a la fecha con
-- una FK compuesta, mismo idioma que `matchdays_size_anchor` (0028).
alter table public.matchdays add constraint matchdays_draw_anchor unique (id, allows_draw);
-- TERCER column-grant sobre `matchdays` (`discipline_id` en 0015, `pair_size`
-- en 0028): `matchdays` tiene grant a nivel columna (0002_rls.sql:236-238) —
-- sin este grant, un insert de `authenticated` que manda `allows_draw` falla
-- con "permission denied for table matchdays", mensaje que NO nombra la
-- columna. Cerrado acá con un test db que crea la fecha como `authenticated`.
grant insert (allows_draw) on public.matchdays to authenticated;

-- ── matches.allows_draw ──────────────────────────────────────────────────
alter table public.matches add column allows_draw boolean not null default false;
update public.matches x set allows_draw = m.allows_draw
  from public.matchdays m where m.id = x.matchday_id;
alter table public.matches add constraint matches_matchday_draw
  foreign key (matchday_id, allows_draw) references public.matchdays (id, allows_draw) on delete cascade;
-- Ancla para que `match_sets` pueda atar su propio `allows_draw` al partido.
alter table public.matches add constraint matches_draw_anchor unique (id, allows_draw);

-- ── match_sets.allows_draw + match_sets_no_draw condicionado ───────────────
alter table public.match_sets add column allows_draw boolean not null default false;
update public.match_sets s set allows_draw = x.allows_draw
  from public.matches x where x.id = s.match_id;
alter table public.match_sets add constraint match_sets_match_draw
  foreign key (match_id, allows_draw) references public.matches (id, allows_draw) on delete cascade not valid;

-- El check viejo (0001:203) era incondicional: "en pádel no hay empates".
-- Se dropea y se reemplaza por la versión condicionada — no se borra una
-- garantía viva para agregar una feature, se la generaliza. Lógica de tres
-- valores: `allows_draw` es `not null` acá (default `false`), así que nunca
-- es NULL en esta columna — el `or` no tiene rama NULL que evaluar.
alter table public.match_sets drop constraint match_sets_no_draw;
alter table public.match_sets add constraint match_sets_no_draw
  check (allows_draw or games_a <> games_b) not valid;
