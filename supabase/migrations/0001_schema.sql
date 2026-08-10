-- ── players ──────────────────────────────────────────────────────────────────
-- Una persona en el sistema. Nace SIN cuenta: el admin tipea el nombre mucho
-- antes de que exista un usuario.
create table public.players (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  user_id      uuid unique references auth.users on delete cascade,
  created_at   timestamptz not null default now()
);

-- ── seasons ──────────────────────────────────────────────────────────────────
create table public.seasons (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  status           text not null default 'SETUP' check (status in ('SETUP', 'ACTIVE', 'FINISHED')),
  config           jsonb not null,
  rules_text       text not null default '',
  rules_updated_at timestamptz,
  -- gen_random_uuid es built-in desde Postgres 13: 122 bits de entropía sin
  -- depender de pgcrypto ni del schema `extensions`, que no existe fuera de
  -- Supabase y haría fallar la migración en cualquier Postgres pelado.
  invite_token     text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by       uuid not null references auth.users on delete restrict,
  created_at       timestamptz not null default now()
);

-- ── matchdays ────────────────────────────────────────────────────────────────
create table public.matchdays (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons on delete cascade,
  number    int  not null check (number >= 1),
  -- El Masters es una fecha más: 4 jugadores, 3 partidos, 6 parejas distintas,
  -- exactamente la forma que ya tienen `pairs` y `matches`. Lo único que NO usa
  -- es `awards`: el spec 2.7 dice que define al campeón del año, no que reparta
  -- puntos. Es columna y no `number = regularMatchdays + 1` porque
  -- `regularMatchdays` se edita con la temporada empezada (spec 2.9), y ahí el
  -- Masters cambiaría de fecha solo.
  kind      text not null default 'REGULAR' check (kind in ('REGULAR', 'MASTERS')),
  status    text not null default 'DRAFT' check (status in ('DRAFT', 'OPEN', 'CLOSED')),
  played_on date,
  closed_at timestamptz,
  unique (season_id, number),
  -- Para que un invitado quede atado a la temporada de su fecha y no a otra.
  unique (id, season_id)
);

-- Una fecha viva por temporada: no se abre la 4 con la 3 a medio cerrar.
create unique index matchdays_one_live    on public.matchdays (season_id) where status <> 'CLOSED';
create unique index matchdays_one_masters on public.matchdays (season_id) where kind = 'MASTERS';
create index matchdays_by_season on public.matchdays (season_id, number);

-- ── entries ──────────────────────────────────────────────────────────────────
-- El asiento. Los partidos referencian ESTO, nunca a un player: reclamar un
-- perfil tiene que ser un update, no reescribir la historia del campeonato.
create table public.entries (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references public.seasons on delete cascade,
  player_id     uuid references public.players on delete set null,
  display_name  text not null default '',
  kind          text not null check (kind in ('SQUAD', 'GUEST')),
  -- SQUAD: su lugar en el orden inicial de la temporada.
  -- GUEST: su lugar entre los invitados de su fecha.
  seed_position int not null check (seed_position >= 0),
  matchday_id   uuid,
  created_at    timestamptz not null default now(),

  constraint entries_shape check (
    (kind = 'SQUAD' and matchday_id is null) or
    (kind = 'GUEST' and matchday_id is not null)
  ),
  -- El invitado puede existir sin nombre para poder generar las parejas; la
  -- fecha no se abre así (spec 2.6), pero eso lo controla el borde.
  constraint entries_squad_named check (kind = 'GUEST' or length(trim(display_name)) > 0),
  constraint entries_guest_matchday
    foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade
);

create unique index entries_seed        on public.entries (season_id, seed_position)   where kind = 'SQUAD';
create unique index entries_guest_order on public.entries (matchday_id, seed_position) where kind = 'GUEST';
create unique index entries_one_seat    on public.entries (season_id, player_id)       where player_id is not null;
create index entries_by_season on public.entries (season_id);

-- ── attendances ──────────────────────────────────────────────────────────────
-- Sólo para asientos SQUAD. El invitado no necesita fila: su propia existencia
-- como entry de esa fecha ya dice que juega.
create table public.attendances (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays on delete cascade,
  entry_id    uuid not null references public.entries   on delete cascade,
  status      text not null check (status in ('PLAYING', 'ABSENT')),
  unique (matchday_id, entry_id)
);

-- ── pair_locks ───────────────────────────────────────────────────────────────
-- Parejas que el admin traba ANTES del sorteo: el equipo invitado que vino a
-- jugar junto, o el invitado que el admin quiere poner con alguien en concreto
-- (spec 2.6). Todavía no son parejas — son una restricción del armado —, y por
-- eso viven aparte de `pairs`.
--
-- Toda pareja trabada tiene que incluir a un invitado. Eso NO se puede escribir
-- como check porque `kind` vive en `entries`: lo impone el borde, y el motivo
-- es que dos del plantel trabados a mano saltearían la regla de no repetir, que
-- es el corazón del formato.
create table public.pair_locks (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays on delete cascade,
  entry_a     uuid not null references public.entries on delete cascade,
  entry_b     uuid not null references public.entries on delete cascade,
  check (entry_a <> entry_b),
  -- Cubren la mitad de "nadie en dos parejas trabadas": alguien podría estar
  -- como entry_a de una y entry_b de otra. Esa mitad la valida el borde.
  unique (matchday_id, entry_a),
  unique (matchday_id, entry_b)
);

create index pair_locks_by_matchday on public.pair_locks (matchday_id);

-- ── pairs ────────────────────────────────────────────────────────────────────
create table public.pairs (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays on delete cascade,
  -- NO cascade: dar de baja a un jugador no puede borrar las parejas de las
  -- fechas que ya se jugaron. `no action` y no `restrict` a propósito: se
  -- verifica al final de la sentencia, así que borrar la temporada entera
  -- —que arrastra fechas y asientos juntos— sigue funcionando.
  entry_a     uuid not null references public.entries on delete no action,
  entry_b     uuid not null references public.entries on delete no action,
  check (entry_a <> entry_b),
  -- Habilita la FK compuesta de matches.
  unique (id, matchday_id)
);

create index pairs_by_matchday on public.pairs (matchday_id);

-- ── matches ──────────────────────────────────────────────────────────────────
create table public.matches (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays on delete cascade,
  round       int  not null check (round >= 1),
  pair_a      uuid not null,
  pair_b      uuid not null,
  check (pair_a <> pair_b),
  -- Un partido sólo enfrenta parejas de SU fecha. Sin esto, un bug de índices
  -- al escribir el fixture arma un round robin donde cada pareja juega contra
  -- quien no debe, y la tabla resultante se ve perfectamente normal.
  foreign key (pair_a, matchday_id) references public.pairs (id, matchday_id) on delete cascade,
  foreign key (pair_b, matchday_id) references public.pairs (id, matchday_id) on delete cascade
);

create index matches_by_matchday on public.matches (matchday_id, round);

-- ── match_sets ───────────────────────────────────────────────────────────────
create table public.match_sets (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches on delete cascade,
  set_number int  not null check (set_number >= 1),
  games_a    int  not null check (games_a >= 0),
  games_b    int  not null check (games_b >= 0),
  unique (match_id, set_number),
  -- En padel no hay empates. Un set igualado no le suma a nadie y el
  -- head-to-head devuelve 0: es un resultado que no puede entrar.
  constraint match_sets_no_draw check (games_a <> games_b)
);

-- ── awards ───────────────────────────────────────────────────────────────────
-- La única desnormalización del diseño, y tiene motivo: si el año que viene
-- cambian la tabla de puntos, el histórico no se mueve.
create table public.awards (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays on delete cascade,
  -- Mismo motivo que en pairs: el histórico no se borra por dar de baja a
  -- alguien. Spec 2.9: las fechas cerradas no se alteran nunca.
  entry_id    uuid not null references public.entries   on delete no action,
  -- Posición del CAMPEONATO: una pareja hecha sólo de invitados no ocupa
  -- puesto, así que puede no coincidir con el lugar en la tabla de la fecha.
  position    int not null check (position >= 1),
  points      int not null check (points > 0),
  unique (matchday_id, entry_id)
);

create index awards_by_matchday on public.awards (matchday_id);
