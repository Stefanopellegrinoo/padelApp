-- torneo-multi-disciplina, tanda 1 ────────────────────────────────────────
--
-- El wizard (PR anterior, `seedNames`) hizo genuinamente POR DISCIPLINA el
-- orden de `discipline_entries.seed_position` — cada disciplina puede pedir
-- el suyo. Eso vuelve falsa la premisa de la decisión #4044
-- (`0023_discipline_entries.sql`, restated en `db/read.ts: seasonSeedOrder`):
-- "el orden a nivel TORNEO es el de la disciplina PRIMARIA". Con una
-- primaria que pidió su propio `seedNames`, esa disciplina secuestra en
-- silencio el orden de la pantalla de Unirse, de Ajustes › Plantel y de la
-- tabla global; y si TODAS las disciplinas piden el suyo, la lista "orden
-- general" del wizard deja de gobernar nada.
--
-- Decisión del dueño (torneo-multi-disciplina, tanda 1): el orden a nivel
-- TEMPORADA se persiste APARTE, en esta tabla — no se vuelve a derivar de
-- ninguna disciplina. `entries.seed_position` sigue sin ser una opción para
-- el SQUAD: 0060/0061/0062/0063/0066 lo eliminaron a propósito (CHECK
-- `entries_seed_shape`, 0060/0066) y 0073 lo reafirma; revivirlo acá sería
-- deshacer esas cinco migraciones.
--
-- Mirror deliberado de `discipline_entries` (0023) menos la mitad
-- "disciplina": mismo PK natural, mismo par de FKs compuestas contra
-- `entries` (una para atar la temporada, otra para fijar `entry_kind =
-- 'SQUAD'` — ver el comentario de 0023 sobre por qué esa FK y no un check),
-- mismo índice único de posición, mismo RLS. La única pieza que 0023 tenía y
-- ésta no es la FK a `disciplines`: esta tabla no cuelga de una disciplina,
-- cuelga de la temporada entera.
create table public.season_seed_order (
  season_id     uuid not null,
  entry_id      uuid not null,
  seed_position int  not null check (seed_position >= 0),
  -- Mismo idioma que `discipline_entries.entry_kind` (0023): la mitad FIJA
  -- de la FK compuesta de abajo. Sin esto, un GUEST podría colarse acá con
  -- un simple insert — la FK, no un comentario, es lo que lo impide.
  entry_kind    text not null default 'SQUAD' check (entry_kind = 'SQUAD'),
  created_at    timestamptz not null default now(),
  primary key (season_id, entry_id),   -- PK natural: nada referencia esta tabla
  foreign key (entry_id, season_id) references public.entries (id, season_id) on delete cascade,
  foreign key (entry_id, entry_kind) references public.entries (id, kind)
);
create unique index season_seed_order_seed     on public.season_seed_order (season_id, seed_position);
create index        season_seed_order_by_entry on public.season_seed_order (entry_id);

-- ── Backfill: cada temporada existente hereda el orden que HOY tiene ───────
-- La primaria de cada temporada (`order by position, created_at limit 1`,
-- el mismo criterio de `defaultDisciplineId`/`create_masters`/`season_invite`)
-- es la fuente: es lo que `seasonSeedOrder` venía leyendo hasta esta PR, así
-- que copiarla es CERO cambio visible para toda temporada que ya existe.
--
-- Quien juega la primaria se lleva su `seed_position` de ahí tal cual —
-- huecos incluidos, si algún `removeSeat` ya los dejó: esta tabla no exige
-- contigüidad (sólo unicidad), y renumerar en el backfill inventaría un
-- orden que nadie pidió.
--
-- Quien NO juega la primaria (REQ-D1-4, "no todos juegan todo") no tiene
-- posición que copiar y no puede quedar afuera —sería perderlo, no
-- degradarlo—, así que entra al FINAL: mismo criterio `?? MAX_SAFE_INTEGER`
-- que `seasonSeedOrder` viene aplicando en TypeScript, acá resuelto en SQL
-- con un `row_number()` sobre el mismo desempate (`created_at, id`) que usa
-- `seasonSquadMembersOf` para ese caso.
with primary_discipline as (
  select distinct on (season_id) season_id, id as discipline_id
    from public.disciplines
   order by season_id, position, created_at
),
squad as (
  select e.id as entry_id, e.season_id, e.created_at
    from public.entries e
   where e.kind = 'SQUAD'
),
seeded as (
  select sq.entry_id, sq.season_id, sq.created_at, de.seed_position
    from squad sq
    left join primary_discipline pd on pd.season_id = sq.season_id
    left join public.discipline_entries de
      on de.discipline_id = pd.discipline_id and de.entry_id = sq.entry_id
),
tail_base as (
  select season_id, coalesce(max(seed_position), -1) as max_seed
    from seeded
   group by season_id
),
tail as (
  select s.entry_id, s.season_id,
         tb.max_seed + row_number() over (partition by s.season_id order by s.created_at, s.entry_id) as seed_position
    from seeded s
    join tail_base tb on tb.season_id = s.season_id
   where s.seed_position is null
)
insert into public.season_seed_order (season_id, entry_id, seed_position)
select season_id, entry_id, seed_position from seeded where seed_position is not null
union all
select season_id, entry_id, seed_position from tail;

-- Mismo tripwire que 0023: si el backfill dejó a alguien afuera, que la
-- migración se caiga ACÁ, ruidosa, y no en un torneo real mostrando el
-- plantel en cualquier orden.
do $$ declare v_want int; v_got int; begin
  select count(*) into v_want from public.entries where kind = 'SQUAD';
  select count(*) into v_got  from public.season_seed_order;
  if v_want <> v_got then
    raise exception 'Backfill incompleto: % asientos SQUAD, % filas en season_seed_order.', v_want, v_got;
  end if;
end $$;

-- Mismo motivo que `discipline_entries` (0023) y `disciplines` (0015/0020):
-- tabla nueva creada después del blanket grant de 0002_rls.sql, así que no
-- lo heredó.
grant select, insert, update, delete on public.season_seed_order to authenticated, service_role;

alter table public.season_seed_order enable row level security;
create policy season_seed_order_read on public.season_seed_order
  for select to authenticated using (public.is_participant(season_id));
create policy season_seed_order_write on public.season_seed_order
  for all to authenticated
  using (public.is_season_admin(season_id)) with check (public.is_season_admin(season_id));
-- Mismo motivo que `discipline_entries`: `anon` no tiene ningún negocio acá.
-- El revoke es necesario — medido, `anon` queda con `Dxtm` (TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN) en esta tabla sin él — pero NO por el
-- blanket grant de 0002_rls.sql:117 (`grant select, insert, update, delete
-- on all tables in schema public`): ese es un grant DE UNA SOLA VEZ, sobre
-- las tablas que existían el día que 0002 corrió — `season_seed_order` nace
-- acá, migraciones después, y nunca lo tocó. Además ese grant ni siquiera
-- incluye TRUNCATE (sólo select/insert/update/delete), así que tampoco sería
-- el mecanismo aunque la tabla hubiera existido.
--
-- La fuente real es `pg_default_acl` del rol `postgres` en el esquema
-- `public`: la misma "Dxtm" que 0002_rls.sql:105-107 mide en las tablas
-- ORIGINALES antes de cualquier grant explícito — un default privilege que
-- Supabase deja armado para toda tabla NUEVA del esquema, no algo que 0002
-- otorgó. (`discipline_entries`/`disciplines` citan el mismo mecanismo
-- equivocado en sus propios comentarios; el revoke ahí también es correcto,
-- sólo la explicación está mal — no se tocan acá, fuera del alcance de esta
-- tanda.)
revoke all on public.season_seed_order from anon;

-- ── shift_season_seeds_up: mismo parking que shift_seeds_up, a nivel temporada ──
-- WU1 (tanda 3, round 2 review fix, agregada acá y no en 0081 donde se
-- USA por primera vez): `db/migrations.unit.test.ts` exige una función por
-- restatement desde 0026 en adelante, y 0080 —a diferencia de 0081/0082/
-- 0083, que ya tienen la suya (`add_squad_seat`/`promote_guest`/
-- `season_invite`)— todavía no define ninguna. `add_squad_seat` (0081) y
-- `promote_guest` (0082) la llaman para honrar `p_before` a nivel TEMPORADA,
-- exactamente el mismo corrimiento que `shift_seeds_up` (0023) ya hacía por
-- disciplina — el comentario grande de 0023 (líneas 92-151) explica el
-- porqué del parking de dos pasadas y el `+2` palabra por palabra; acá sólo
-- cambia la tabla y la columna de scope (`season_id` en vez de
-- `discipline_id`).
--
-- Plana, no `security definer`: hereda el rol de quien la llama, que durante
-- `add_squad_seat`/`promote_guest` YA es el dueño DEFINER de esas
-- funciones — y con el `execute` sacado a `public`, `anon` Y
-- `authenticated`: nadie la llama por RPC, sólo esas dos.
create function public.shift_season_seeds_up(p_season uuid, p_from int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_park int;
begin
  select coalesce(max(seed_position), -1) + 2 into v_park
    from public.season_seed_order
   where season_id = p_season;

  update public.season_seed_order
     set seed_position = seed_position + v_park
   where season_id = p_season and seed_position >= p_from;

  update public.season_seed_order
     set seed_position = seed_position - v_park + 1
   where season_id = p_season and seed_position >= v_park;
end;
$$;

revoke execute on function public.shift_season_seeds_up(uuid, int) from public, anon, authenticated;
