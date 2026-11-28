-- amigos-faciles, S8 (odd/tasks/amigos-faciles.md, T8) ─────────────────────
--
-- "Que me encuentren por mi usuario": si apareces en el buscador por @usuario
-- (0124). Viene prendido para todos —la respuesta fue "Todos, con opción de
-- salir"— y cada uno lo apaga en su perfil con `set_my_discoverable` (0125).
-- Apagado, nadie te encuentra en el buscador, tampoco tus amigos; te siguen
-- pudiendo sumar con tu link o desde un torneo.
--
-- Sin grants nuevos: `players` no se escribe a mano desde 0118, así que esto
-- sólo cambia por la función, que saca el jugador de `auth.uid()`.
--
-- No-destructivo (L5): una columna nueva con default, prendida en todas las
-- filas. Ninguna otra columna cambia.
alter table public.players
  add column discoverable boolean not null default true;
