-- ── season_invite ordena por discipline_entries, no por entries.seed_position ──
--, (tanda de cierre): el picker de Unirse
-- (`app/unirse/[token]`) seguía ordenando por `e.seed_position`
-- (`entries.seed_position`, dual-write tail-only desde PR 7 —
-- 0023_discipline_entries.sql), no por el orden real del plantel
-- (`discipline_entries.seed_position`). Efecto medido: el admin agrega un
-- asiento "antes de Juan", `discipline_entries` lo guarda en su lugar, y el
--Picker lo muestra ÚLTIMO igual — el mismo síntoma de C6 (ronda 3), acá en
-- la pantalla de Unirse.
--
-- `create or replace` alcanza: esta migración no toca ni el `returns table`
-- ni la lista de parámetros de `season_invite`, sólo el cuerpo (agrega un
-- `left join` y cambia el `order by`) — a diferencia de PR 9/0025, que sí
-- necesitó `drop function` + `create` porque ahí el shape de retorno cambiaba
-- (42P13, "cannot change return type of existing function").
--
-- Se ordena por la disciplina POR DEFECTO (`position, created_at`, mismo
-- criterio que `defaultDisciplineId`, db/season.ts): la invitación es de LA
--TEMPORADA (REQ-D1-3, `entries` sigue siendo el plantel compartido), no de
-- una disciplina en particular, así que no hay otra disciplina "correcta"
-- para elegir acá sin el wizard multi-disciplina (PR 11). Un asiento sin fila
-- en `discipline_entries` de esa disciplina por defecto (hoy inalcanzable:
--Ver C9, misma ronda) NO se excluye —el picker tiene que mostrar TODOS los
-- asientos libres de la temporada para que un extraño pueda reclamar
-- cualquiera, no sólo los de una disciplina— y cae al final, ordenado entre
-- sí por su propio `entries.seed_position` (deuda ya anotada para PR 11/27 en
--).
create or replace function public.season_invite(p_token text)
returns table (
  season_id     uuid,
  season_name   text,
  admin_name    text,
  squad_size    int,
  entry_id      uuid,
  display_name  text,
  seed_position int,
  claimed       boolean,
  disciplines   text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.name,
         admin.display_name,
         (select count(*)::int from public.entries e2
           where e2.season_id = s.id and e2.kind = 'SQUAD'),
         e.id,
         e.display_name,
         e.seed_position,
         e.player_id is not null,
         coalesce((
           select array_agg(d2.kind order by d2.position, d2.created_at)
             from public.discipline_entries de2
             join public.disciplines d2 on d2.id = de2.discipline_id
            where de2.entry_id = e.id
         ), array[]::text[])
    from public.seasons s
    join public.players admin on admin.user_id = s.created_by
    join public.entries e on e.season_id = s.id and e.kind = 'SQUAD'
    left join public.discipline_entries de
      on de.entry_id = e.id
     and de.discipline_id = (
           select d.id from public.disciplines d
            where d.season_id = s.id
            order by d.position, d.created_at
            limit 1
         )
   where s.invite_token = p_token
   order by (de.seed_position is null), de.seed_position, e.seed_position
$$;

revoke execute on function public.season_invite(text) from public, anon;
grant  execute on function public.season_invite(text) to authenticated;
