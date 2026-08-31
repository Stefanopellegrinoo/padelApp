-- Partido → personas. Una fila por jugador por partido, con el lado en el que
-- estuvo. Es lo único que hace falta para responder "todos los partidos entre
-- X e Y": un self-join sobre esta vista, filtrando por dos player_id.
--
-- ── POR QUÉ UNA VISTA `security_invoker` Y NO UNA FUNCIÓN ───────────────────
--
-- La forma natural sería `friend_match_history(p_jugador_a, p_jugador_b)`
-- `security definer`. Es una FUGA: security definer saltea RLS, así que
-- cualquiera podría pedir el historial de dos personas cualesquiera. La
-- convención del repo lo evita derivando la identidad de auth.uid() del lado
-- del servidor (claim_seat, my_player_id), pero acá hacen falta DOS personas y
-- sólo una es el caller.
--
-- Con `security_invoker = on` la RLS de matches/pairs/entries se evalúa como
-- QUIEN CONSULTA. La vista no puede devolver un partido de una temporada en la
-- que el caller no participa, y no hay parámetro que falsificar. El agujero no
-- se tapa: no se cava.
--
-- ── POR QUÉ `or` Y NO UN JOIN A CADA COLUMNA ───────────────────────────────
--
-- `pairs.entry_b` es NULLABLE con disciplinas de a uno (0028_side_size.sql:68).
-- Un `join entries on e.id = p.entry_b` descarta la fila entera cuando es null,
-- o sea que borra TODOS los partidos individuales del historial — con la suite
-- en verde, porque hoy nada mira esto. Con `or`, la mitad nula simplemente no
-- matchea y el partido sobrevive con sus dos jugadores.
create view public.match_participants
with (security_invoker = on) as
  select m.id          as match_id,
         m.matchday_id as matchday_id,
         p.id          as pair_id,
         case when p.id = m.pair_a then 'A' else 'B' end as side,
         e.player_id   as player_id
    from public.matches m
    join public.pairs   p on p.id = m.pair_a or p.id = m.pair_b
    join public.entries e on e.id = p.entry_a or e.id = p.entry_b
   where e.player_id is not null;

-- Mismo par que toda tabla y vista nueva de este repo. `anon` no tiene nada
-- que hacer acá: la única superficie pública del sistema es Reglas.
grant select on public.match_participants to authenticated, service_role;
revoke all on public.match_participants from anon;
