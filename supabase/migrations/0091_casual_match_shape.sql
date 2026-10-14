-- La forma del partido casual (tablas en 0072, RLS en 0090): cada lado tiene
-- 1 o 2 jugadores, los dos lados la misma cantidad, y quien lo carga es uno
-- de ellos. Ningún CHECK puede decir esto -- es una cuenta sobre OTRA tabla
-- (`casual_match_players`) -- así que es un constraint trigger.
--
-- DIFERIDO (`initially deferred`) porque un partido se arma en varias
-- sentencias: primero la fila del partido, después sus jugadores de a uno
-- (0092). Chequeado fila por fila al insertar, el primer jugador ya sería un
-- "1 contra 0". Diferido, la cuenta corre al COMMIT, con el partido entero a
-- la vista, y si falla se cae la transacción completa: nunca queda un partido
-- a medias.
--
-- Corre en INSERT del partido (un partido sin ningún jugador también es una
-- forma mala) y en INSERT de cada jugador. NO en delete: el `on delete
-- cascade` de `player_id` (0072) puede dejar un partido desparejo si se
-- borra una cuenta, y eso está aceptado ahí.
--
-- `security definer` + `search_path = ''`: la cuenta que hace cumplir un
-- invariante no puede depender de lo que la RLS le deja ver a quien escribe.
-- Como invoker, `casual_match_players_read` (0090) filtraría la cuenta por
-- `is_casual_participant` -- hoy daría lo mismo para el creador, pero una
-- regla de forma que cuenta "las filas que vos ves" en vez de "las filas que
-- hay" es una puerta que se abre el día que alguien cambie una política.
create function public.casual_match_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match   uuid;
  v_creator uuid;
  v_a       int;
  v_b       int;
  v_plays   boolean;
begin
  -- Dos `if` y no un `case`: plpgsql resuelve `new.<columna>` contra la
  -- tabla del trigger, y `new.id` no existe en `casual_match_players`.
  if tg_table_name = 'casual_matches' then
    v_match := new.id;
  else
    v_match := new.match_id;
  end if;

  select m.created_by into v_creator
    from public.casual_matches m
   where m.id = v_match;
  -- Borrado en la misma transacción, antes del commit: no hay forma que
  -- chequear.
  if not found then
    return null;
  end if;

  select count(*) filter (where p.side = 'A'),
         count(*) filter (where p.side = 'B'),
         coalesce(bool_or(p.player_id = v_creator), false)
    into v_a, v_b, v_plays
    from public.casual_match_players p
   where p.match_id = v_match;

  if v_a not between 1 and 2 or v_a <> v_b then
    raise exception 'Un partido casual es 1 contra 1 o 2 contra 2 (este tiene % contra %).', v_a, v_b
      using errcode = '23514';
  end if;
  if not v_plays then
    raise exception 'Quien carga el partido tiene que haberlo jugado.'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger casual_match_shape
  after insert on public.casual_matches
  deferrable initially deferred
  for each row execute function public.casual_match_shape();

create constraint trigger casual_match_shape
  after insert on public.casual_match_players
  deferrable initially deferred
  for each row execute function public.casual_match_shape();

-- Mismo reflejo que el resto del repo para TODA función nueva (0002_rls.sql:
-- 83-93), aunque un trigger no se pueda llamar a mano.
revoke execute on function public.casual_match_shape() from public, anon;
