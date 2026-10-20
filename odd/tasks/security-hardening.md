# Security hardening

**Objetivo:** endurecer los atributos de calidad de seguridad de la app sin cambiar funcionalidades.
**Rama:** `feat/security-hardening` (a crear desde `main`, árbol limpio verificado).
**Estrategia de entrega:** `ask-on-risk` (default). Cadena decidida (L6): **stacked-to-main** — cada slice mergea a main en orden.
**Test runner:** `npm test` (vitest unit) y `npm test:db` (vitest, `vitest.db.config.ts`).

## Specs

### S1 — Impedir que un usuario anote a otro jugador escribiendo `player_id`
Requerimiento del usuario: "cualquiera puede anotar a otro jugador en un torneo propio vacío, y a ese jugador se le rompe Mis torneos".
Causa raíz verificada: `entries_write` es `for all` con grant de columnas completo, y sólo exige `is_season_admin(season_id)`; `players_read using(true)` expone `id` y `display_name` de todos los jugadores. Un admin de su propia temporada puede escribir `player_id = <víctima>` en una entry sin pasar por `claim_seat`.
Alcance: restringir la escritura directa de `player_id` (y del resto de columnas que hoy son libremente escribibles) sin romper el reclamo legítimo vía `claim_seat` ni el alta de plantel vía `add_squad_seat`/`promote_guest`.
Criterio de aceptación: un usuario autenticado NO puede modificar `player_id` de una entry por PostgREST directo; `claim_seat` sigue siendo el único camino para vincular un jugador a un asiento.
Checks: `npm test:db` (suites `db/claim.db.test.ts`, `db/rls.db.test.ts`), más un test nuevo que pruebe el PATCH directo de `player_id`.

### S2 — Revocar `TRUNCATE` (atraviesa RLS)
Hallazgo: `0002_rls.sql` otorga DML sin revocar `TRUNCATE`; RLS no aplica a `TRUNCATE`. `TRUNCATE public.match_sets` borraría resultados de todas las temporadas.
Alcance: revocar `TRUNCATE` de todas las tablas públicas; verificar que `0080` ya lo hizo para `season_seed_order` y replicar.
Criterio de aceptación: `TRUNCATE` no ejecutable por `authenticated`/`anon`; sólo `postgres`/`service_role` donde corresponda.
Checks: `npm test:db`.

### S3 — Restringir la enumeración de jugadores
Requerimiento del usuario: "cualquier usuario puede leer los nombres de todos los jugadores".
Causa raíz: `players_read for select using (true)` + grant de columnas `(id, display_name, created_at)`.
Alcance: quitar la lectura global de `players` manteniendo las resoluciones de nombre que la app necesita (`playerNames`, `seasonAdminName`) vía funciones `security definer` con filtro por participación/contexto.
Criterio de aceptación: `SELECT id, display_name FROM players` directo por PostgREST ya no devuelve el directorio completo; las pantallas que muestran nombres siguen funcionando.
Checks: `npm test:db`, `npm test` (pantallas que usan `playerNames`/`seasonAdminName`).

### S4 — Cerrar el open redirect con barra invertida
Requerimiento del usuario: "redirección abierta en el login con /login?next=/\evil.com".
Causa raíz: `safeNextPath` acepta `/\evil.com` (empieza con `/`, no con `//`).
Alcance: rechazar también `\` en `safeNextPath`, con test.
Criterio de aceptación: `safeNextPath('/\\evil.com') === '/'`.
Checks: `npm test` (`app/auth/next-path.unit.test.ts`), test nuevo para el caso backslash.

### S5 — Cookies de sesión con `Secure` y `HttpOnly`
Requerimiento del usuario: "las cookies de sesión no tienen Secure".
Causa raíz: `DEFAULT_COOKIE_OPTIONS` de `@supabase/ssr` (`httpOnly: false`, sin `secure`, `sameSite: lax`); `db/server.ts` y `db/client.ts` no sobrescriben.
Alcance: configurar `secure: true` y `httpOnly: true` en producción (vía `NODE_ENV`/env), sin romper el flujo local de desarrollo.
Criterio de aceptación: en producción las cookies de sesión llevan `Secure` y `HttpOnly`.
Checks: `npm run typecheck`; verificación manual de cabeceras de cookie.

### S6 — Cabeceras de seguridad HTTP
Requerimiento del usuario: "la app no manda las cabeceras de seguridad (CSP y compañía)".
Causa raíz: `next.config.ts` vacío.
Alcance: agregar `headers()` con CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy y HSTS (solo en HTTPS/producción).
Criterio de aceptación: las respuestas incluyen las cabeceras de seguridad; la app no se rompe (CSP compatible con Supabase y los assets).
Checks: `npm run build`, navegación manual.

### S7 — Límites de longitud en inputs
Requerimiento del usuario (reformulado): "un email gigante puede trabar el servidor varios segundos al registrarse".
Corrección verificada: la regex es lineal, no ReDoS; el problema es la ausencia de límites de longitud en email, password, nombre, reglas y config.
Alcance: agregar `maxLength` en la validación server-side (y el `check` de columna donde corresponda) para email, contraseña, `display_name`, nombre de torneo, `rules_text` y `config`.
**Restricción de producción (L5):** hay datos reales en producción. NO agregar `check` de longitud a nivel de columna en esta feature — validar sólo en la capa de app (server-side), que no toca filas existentes. Un `check` de columna fallaría si ya hay datos que lo violan.
Criterio de aceptación: inputs por encima del límite son rechazados antes de llegar a Supabase/Postgres.
Checks: `npm test`, `npm test:db`.

### S8 — Invitación con expiración/regeneración y lectura restringida al admin
Requerimiento del usuario: "el link de invitación no vence ni se puede regenerar".
Hallazgo adicional: cualquier participante puede leer `invite_token` por RLS y compartirlo.
Alcance: agregar expiración (o regeneración) del `invite_token`; restringir la lectura del token al admin (no a participantes); el compartir-link legítimo del admin sigue funcionando.
Criterio de aceptación: un participante no puede leer `invite_token` por PostgREST; el admin puede verlo y regenerarlo; un link viejo no reclama asiento.
Checks: `npm test:db` (`db/claim.db.test.ts`, `db/rls.db.test.ts`).

### S9 — Registro endurecido: captcha (la confirmación de email ya está prendida en prod)
Requerimiento del usuario: "el registro está abierto, sin captcha ni confirmación de email".
**Corrección (verificado en `docs/despliegue.md:237-244`):** la confirmación de email **YA está habilitada en producción** (medido: un alta devolvió `confirmation_sent_at` y sin `access_token`). En local está en `false`, por eso el usuario nunca la vio. Lo único que falta es **captcha**.
Causa raíz: bloque `[auth.captcha]` comentado en `config.toml`; en prod el captcha se configura desde el dashboard de Supabase (Authentication → Bot and Abuse Protection).
Alcance: habilitar captcha (decisión de producto pendiente sobre proveedor: hcaptcha vs turnstile).
Criterio de aceptación: el alta exige captcha en producción.
Checks: verificación de flujo manual.
Nota: requiere decisión de producto (ver Log L4). NO es una migración: es configuración del dashboard.

### S10 — Subir el mínimo y los requisitos de contraseña
Hallazgo: mínimo 6 caracteres y `password_requirements` vacío.
Alcance: subir mínimo a 8 y habilitar requisitos razonables, alineando `app/auth/actions.ts` con `config.toml`.
Criterio de aceptación: contraseñas de menos de 8 caracteres son rechazadas.
Checks: `npm test`, `npm test:db` (`db/auth.db.test.ts`).

### S11 — Actualizar Next a la versión parcheada
Requerimiento del usuario: "Next tiene una versión de parche más nueva".
Verificado: `15.5.23` instalado; `15.5.28` disponible; `npm audit` reporta 4 vulns (next critical RCE, postcss high, sharp high, source-map-js high).
Alcance: actualizar `next` a `15.5.28` (o la última de la rama 15), correr `npm audit`.
Criterio de aceptación: `npm audit --omit=dev` sin vulnerabilidades críticas/altas en `next`; suite verde.
Checks: `npm test`, `npm run build`, `npm audit --omit=dev`.

### S12 — CI con permisos mínimos
Hallazgo: `.github/workflows/ci.yml` sin bloque `permissions`.
Alcance: agregar `permissions: { contents: read }` (o lo mínimo necesario).
Criterio de aceptación: `GITHUB_TOKEN` no hereda alcance de escritura innecesario.
Checks: revisión del workflow; CI verde.

### S13 — No exponer la contraseña de producción en argumentos de proceso
Hallazgo: `scripts/corte-prod/corte.sh` pasa el URI con contraseña como argumento a `psql`/CLI.
Alcance: pasar credenciales por env var o `.pgpass`, no por argv.
Criterio de aceptación: la contraseña no es visible en `ps` durante el corte.
Checks: revisión manual del script.

### S14 — Filtrar mensajes de error que llegan a la URL
Hallazgo: `acceptFriendship` copia `error.message` a `?error=` en la URL.
Alcance: no reflejar mensajes crudos de Postgres en la URL; devolver un mensaje genérico.
Criterio de aceptación: un `friendshipId` malformado no expone el mensaje del parser de Postgres.
Checks: `npm test` (`db/friends.db.test.ts`, `app/amigos`).

### S15 — Cerrar el oráculo de metadatos de las RPC `SECURITY DEFINER`
Hallazgo: `matchday_season`, `match_season`, `match_is_open`, `players_can_score` no validan participación.
Alcance: agregar validación de participación/contexto antes de responder.
Criterio de aceptación: un usuario ajeno no puede consultar el `season_id`/estado de una fecha que no le pertenece.
Checks: `npm test:db`.

### Invariantes a preservar (ya verificados como correctos)
- RLS habilitado en todas las tablas.
- `search_path = ''` en funciones `security definer`.
- `service_role` ausente del código de app (sólo `db/test/admin.ts`).
- XSS protegido: `renderAdminMarkdown` escapa antes de formatear.
- No hay SQLi (parámetros bindeados), no hay ReDoS, no hay SSRF, no hay mass assignment, no hay path traversal.

## Tasks

- T1 [S1] Restringir `entries_write` (column grants) para que `player_id` sólo se vincule vía `claim_seat`. Ruta: delegado (escritor). Commit: —
- T2 [S2] Migración: revocar `TRUNCATE` en tablas públicas. Ruta: inline. Commit: —
- T3 [S3] Reemplazar `players_read using(true)` por funciones `security definer` de resolución de nombres. Ruta: delegado (escritor). Commit: —
- T4 [S4] `safeNextPath` rechaza backslash + test. Ruta: inline. Commit: —
- T5 [S5] Configurar `secure`/`httpOnly` en cookies (prod vs dev). Ruta: inline. Commit: —
- T6 [S6] Cabeceras de seguridad en `next.config.ts`. Ruta: inline. Commit: —
- T7 [S7] Límites de longitud en inputs. Ruta: inline. Commit: —
- T8 [S8] Expiración/regeneración de `invite_token` + lectura restringida al admin. Ruta: delegado (escritor). Commit: —
- T9 [S9] Habilitar captcha (config dashboard, no migración; requiere decisión de proveedor hcaptcha vs turnstile). Ruta: pendiente. Commit: —
- T10 [S10] Mínimo de contraseña a 8 + requisitos. Ruta: inline. Commit: —
- T11 [S11] Actualizar Next + `npm audit`. Ruta: inline. Commit: —
- T12 [S12] Bloque `permissions` en CI. Ruta: inline. Commit: —
- T13 [S13] Credenciales por env/`.pgpass` en `corte.sh`. Ruta: inline. Commit: —
- T14 [S14] Filtrar `error.message` en `acceptFriendship`. Ruta: inline. Commit: —
- T15 [S15] Validación de participación en RPC `SECURITY DEFINER`. Ruta: delegado (escritor). Commit: —

## Log

- L1 (2026-10-20) — Pedido original del usuario: "Quiero que me ayudes a mejorar la app para hacerla mas profesional. No quiero mejorar las funcionalidades sino que los atributos de calidad. Empecemos por seguridad. Ya estuve viendo un par de problemas, quiero que los verifiques y veas si encontras mas." + lista de 8 hallazgos con severidad (anotar a otro jugador en torneo propio; registro abierto sin captcha/confirmación/límites; open redirect `/login?next=/\evil.com`; email gigante; leer nombres de todos los jugadores; cookies sin Secure y sin cabeceras; link de invitación sin vencimiento y Next desactualizado; ya-bien: RLS/search_path/service_role/XSS).
- L2 (2026-10-20) — Verificación de los 8 hallazgos contra el código, confirmados (dos matices: sí hay rate limit en auth; la regex de email es lineal, no ReDoS). Hallazgos extra: `TRUNCATE` atraviesa RLS, cookies `httpOnly:false`, sin límites de longitud, `entries_write for all` permite delete/insert directo.
- L3 (2026-10-20) — Auditoría multi-vertical con 6 agentes en paralelo (autenticación, RLS, tokens/secretos, inyección/validación, exposición de datos, config/cabeceras). Resultados: 6 hallazgos nuevos (TRUNCATE; oráculo RPC; participants leen invite_token; contraseña en argv; error sin filtrar en URL; CI sin permissions). Controles negativos: sin SQLi/ReDoS/XSS/SSRF/mass-assignment/path-traversal.
- L4 (2026-10-20) — Decisión de producto pendiente en S9: proveedor de captcha (hcaptcha vs turnstile) y si la confirmación de email aplica a producción. No bloquea el resto de tasks.
- L5 (2026-10-20) — **Restricción de producción (usuario):** "en produccion hay datos importantes, no muchos pero hay, asi que tene mucho cuidado". Impacto: (a) NO agregar `check` de longitud a nivel de columna en S7 (validar sólo en app, no toca filas); (b) toda migración SQL debe ser no-destructiva y reversible; (c) no correr `supabase db reset` contra producción bajo ningún concepto; (d) ante cualquier ambigüedad sobre datos existentes, parar y preguntar. S1–S8 no borran datos (son grants/políticas/código/config), pero S7 y S8 requieren cuidado extra con datos preexistentes.
- L6 (2026-10-20) — Decisiones de alcance (usuario): **Núcleo Alta/Media (S1–S8)**, deja Low (S10–S15) para feature siguiente. Estrategia de entrega: **stacked-to-main** (cada slice mergea a main en orden).
- L7 (2026-10-20) — **Camino de deploy verificado** (`docs/despliegue.md:46-64,144-146`): CLI, no pipeline. Para migraciones nuevas: backup (`db dump` roles/schema/data) → `supabase db push --db-url "$PROD_DB_URL" --dry-run` → `supabase db push --db-url "$PROD_DB_URL"` → merge a `main` (Vercel deploya solo). **NUNCA `supabase link`** (deja el repo apuntando a prod). `PROD_DB_URL` = URI del Session pooler con contraseña escapada. Nada automatiza el push: CI no toca la nube.
- L8 (2026-10-20) — Corrección a S9: la confirmación de email **ya está prendida en producción** (`docs/despliegue.md:237-244`), en local no. S9 queda reducido a habilitar captcha (config de dashboard, no migración). También: `docs/despliegue.md:311-338` advierte que `.env.local` está fallando el parse con `LegacyDbConfigLoadError` y rompe `db:reset`/`test:db` local — hay que arreglarlo antes de correr las suites contra la base.
- L9 (2026-10-20) — **Retomada la feature.** Baseline verificado verde al arrancar: `db:reset` EXIT=0, `test:db` 675/675, `npm test` 1606/1606, `typecheck` limpio. El bloqueo de `.env.local` (L8) **ya no reproduce**; no hizo falta ningún cambio de repo. Rama `feat/security-hardening` creada desde `main` (63376fa, ya al día con origin). Causa raíz del error original sigue sin determinar (probable ambiental/transitoria). `docs/despliegue.md:311` quedó obsoleta.
