-- amigos-faciles, S7 (odd/tasks/amigos-faciles.md, T7) ─────────────────────
--
-- El @usuario: con él te encuentran tus amigos (S8). Lo elegís una sola vez
-- y no se cambia, así que la columna es nullable a propósito: a las cuentas
-- que ya existen no se les genera uno, lo eligen ellas en la pantalla única
-- (`/elegir-usuario`). Quien se registra lo trae en el alta (0119).
--
-- Se guarda siempre en minúsculas —el `check` no deja otra cosa— y por eso el
-- `unique` común ya es "único sin importar mayúsculas": `Nico.Arias` llega
-- como `nico.arias` y choca con el que ya está. Los `null` no chocan entre sí.
--
-- No-destructivo (L5): una columna nueva, nula en todas las filas, más su
-- índice. Ninguna fila existente cambia.
alter table public.players
  add column username text,
  add constraint players_username_key unique (username),
  add constraint players_username_shape check (username ~ '^[a-z0-9][a-z0-9._]{2,19}$');

-- ── permisos ────────────────────────────────────────────────────────────────
-- 0002 dejó `insert`/`update`/`delete` sobre `players` otorgados a
-- `authenticated` a nivel tabla, frenados sólo por RLS (no hay política de
-- escritura). Con una columna que no se puede cambiar nunca, eso es una sola
-- política mal escrita de distancia, así que se sacan: nadie escribe
-- `players` a mano. El alta (0119) y `choose_my_username` (0121) son
-- `security definer` y escriben como dueñas; `service_role` no se toca.
revoke insert, update, delete on public.players from authenticated, anon;
