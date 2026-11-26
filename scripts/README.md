# scripts/

Scripts de navegador para este repo. Ninguno agrega una dependencia: todos
resuelven Playwright desde `PLAYWRIGHT_DIR` (`playwright.mjs`), no desde
`node_modules`. Ver el docblock de cada archivo para el detalle.

| Script | Qué hace |
|---|---|
| `playwright.mjs` | Cargador compartido de Chromium. No se corre solo. |
| `smoke.mjs` | Recorrido funcional end-to-end contra la base. |
| `ux-seed.ts` | Siembra la escena para medir feedback táctil (`npx tsx scripts/ux-seed.ts`). |
| `deadlock/battery.sh` | Gate de deadlocks del camino de escritura del plantel (`npm run test:deadlock`). |
| `ux-measure.mjs` | Mide `T_first_visible_change_ms` de 23 toques y compara contra `ux-baseline.json`. |
| `mobile-audit.mjs` | Auditoría móvil de toda la app con teléfonos emulados (WebKit tipo iPhone, Chromium tipo Android): desbordes, textos cortados o pisados, campos de menos de 16 px. Sale con código 1 ante cualquier hallazgo (`npm run audit:mobile`). |
| `design-gallery.mjs` | Galería de solo lectura de las maquetas de `design/` en `http://100.81.177.86:8091/`, visible solo en la tailnet (`node scripts/design-gallery.mjs`; `GALLERY_HOST` y `GALLERY_PORT` la cambian). En el servidor corre como servicio de usuario `padel-design-gallery` (`~/.config/systemd/user/`), que arranca solo al reiniciar. |

## Correr la medición de feedback táctil

```
npm run db:reset
npx tsx scripts/ux-seed.ts
npm run dev                          # otra terminal
BASE_URL=http://localhost:3000 node scripts/ux-measure.mjs
```

**Por qué el overlay de dev se suprime a propósito**: Next 15 muestra un
`<nextjs-portal>` en desarrollo que reacciona al instante a cualquier
acción/ruta pendiente, la haga visible la app o no. Sin ocultarlo
(`page.addInitScript`, sólo del lado del test), TODAS las interacciones miden
50-90ms sin importar qué tan lenta sea la app de verdad — es la señal de
carga que un usuario en producción nunca ve, y la razón por la que el bug
original pasó desapercibido en una primera medición.

**Hay que resembrar ANTES DE CADA corrida.** El script no es idempotente:
cierra fechas, arma parejas y consume la escena que `ux-seed.ts` prepara.
Correrlo dos veces seguidas sin `db:reset` no da "dos mediciones": da una
medición y una corrida de timeouts contra una escena que ya no existe. Si
aparecen varias filas en `⚠ ERROR`, es esto casi siempre.

`ux-baseline.json` queda commiteado como referencia: cada corrida imprime
`label | baseline | ahora | delta` y sale con código 1 si alguna interacción
supera el **techo de 150ms** o no se pudo medir.

El gate es un techo absoluto y NO una comparación contra el baseline, a
propósito: los checkpoints van de 20 en 20ms y cada screenshot cuesta ~30ms,
así que un toque rápido cae siempre en 50, 82, 86 o 100 y nunca en un valor
intermedio. Medido: `14-cerrar-fecha` dio 51ms y 82ms en dos corridas limpias
consecutivas sobre el mismo commit. Comparar deltas en esa zona mide el
instrumento, no la app — y un gate que falla sobre código sin cambios enseña
a ignorarlo. El delta queda impreso como información.

Si una interacción corrió con error (ej. sesión caída, redirect inesperado)
la fila lo marca con `⚠ ERROR: ...` aunque el número medido parezca legítimo,
y cuenta como fallo: no medir no demuestra nada.

## Medir con latencia de base simulada (`SUPABASE_TRACE_MS`)

Este harness corre contra Supabase LOCAL, donde una consulta cuesta ~0ms. Un
número verde ahí NO prueba nada sobre lo que pasa contra una base a distancia
real — así se coló una lectura de 84ms para una interacción que el usuario
sentía como 2 segundos (ver `db/client.ts`, docblock de `traced`). Para medir
de verdad hacen falta DOS terminales:

```
# Terminal 1 — servidor con el instrumento prendido
SUPABASE_TRACE_MS=120 npm run dev -- -p 3003

# Terminal 2 — el harness, contra ese puerto
BASE_URL=http://localhost:3003 node scripts/ux-measure.mjs
```

Con `SUPABASE_TRACE_MS` puesto, la Terminal 1 imprime una línea por consulta:
`[db] #N {ms}ms {método} {path}`, con `N` reiniciado tras una pausa de más de
400ms — así la ÚLTIMA línea de una ráfaga (un tilde de asistencia, por
ejemplo) ya lee la cuenta completa de esa ráfaga, sin contar líneas a mano.

**El harness (Terminal 2) NO puede leer esa cuenta.** Corre en otro proceso, y
las Server Actions de Next 15 no tienen forma soportada de devolver un header
con ese número en la respuesta. El harness sigue midiendo lo suyo
—`T_first_visible_change_ms`, que es del lado del cliente y no depende de la
latencia inyectada—; la cuenta de consultas se lee a ojo en la Terminal 1,
una interacción a la vez (ver el `Nota: ` en `traced` sobre tráfico
concurrente).

`SUPABASE_TRACE_MS` es inerte sin el env var, y **imposible** de prender en
`next build`/producción: `NODE_ENV` lo tapa desde afuera, no el env var por sí
solo (detalle completo en el docblock de `db/client.ts`).

## Auditoría móvil (`mobile-audit.mjs`)

Recorre cada pantalla y cada estado de la app (sin sesión, Inicio y sus hojas,
el asistente de crear torneo paso a paso, Tabla, Fechas y cada fecha de la
escena —abierta con la hoja de carga, cerrada, llave, Masters, armado,
ajedrez, bowling—, Stats, Jugador, Ajustes y cada hoja, Reglas con "Más
detalle" abierto, Amigos, el perfil de un amigo con la hoja de partido en
varios deportes y corrigiendo, el torneo rápido hasta el campeón, privacidad,
borrar cuenta, 404 y `offline.html`) con los `devices` de Playwright, que
emulan el teléfono de verdad: `isMobile`, táctil, densidad de pantalla y user
agent. Los chequeos de antes usaban un navegador de escritorio angosto y no
veían lo que pasa en un iPhone.

En cada estado (con la hoja abierta, mira la hoja) busca:

| Tipo | Qué es |
|---|---|
| `overflow` | Algo se sale del ancho de la pantalla, o la página scrollea de costado. Lo que vive en un carril con scroll propio no cuenta. |
| `cut` | Un elemento queda cortado por un contenedor con `overflow: hidden`. |
| `clipped` | Un texto no entra en su caja y no es un "…" a propósito. |
| `broken-word` | Una palabra (un nombre) partida en dos renglones porque su columna no tiene lugar ("Mart / ín"). |
| `overlap` | Dos textos, o un texto y una pieza chica pintada (las rayitas de progreso), se pisan. |
| `font` | Un `input`, `select` o `textarea` (date y number incluidos) con letra de menos de 16 px: iOS hace zoom al enfocarlo. |
| `native-date` | Un `<input type="date">` nativo a la vista: en iOS no respeta el ancho. Va dentro de `CampoFecha` (`app/ui/campo-fecha.tsx`). |
| `zoom` | (sólo WebKit) Al enfocar cada campo, `visualViewport.scale` deja de ser 1. El WebKit de Playwright en Linux no reproduce el zoom de iOS al enfocar, así que esto es una red; el chequeo que manda es `font`. |
| `error` / `js-error` | Una escena no se pudo recorrer, o la página tiró un error de JS. |

Imprime una tabla `dispositivo | página | tipo | elemento | detalle` y **sale
con código 1 si hay cualquier hallazgo**, 0 si todo da cero (2 si falta `BASE_URL`).

Necesita la app corriendo con la escena local (`npx tsx scripts/ux-seed.ts`
más los torneos de las tareas del rediseño; ver `AUDIT_TOURNAMENTS` en el
script) y no escribe en la base: abre hojas y las cierra sin guardar. El
torneo rápido usa `localStorage` y lo deja vacío al terminar.

### WebKit (iPhone) — en Docker

El WebKit de Playwright no corre en este host (le faltan librerías del
sistema), así que va en la imagen oficial, con Playwright instalado en una
carpeta aparte (`PLAYWRIGHT_DIR`, ninguna dependencia nueva en el repo):

```
mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright@1.65.1)
docker run --rm --network host --shm-size=1g \
  -v "$PWD/scripts:/scripts:ro" -v /tmp/pw:/pw:ro -v /tmp/shots:/shots \
  -e PLAYWRIGHT_DIR=/pw -e BASE_URL=http://localhost:3100 \
  -e SHOTS_DIR=/shots -e SHOT_PREFIX=audit -e SHOT_THEMES=light,dark \
  mcr.microsoft.com/playwright:v1.65.1-noble node /scripts/mobile-audit.mjs
```

Por defecto: iPhone SE (320), iPhone 13 (390) y iPhone 14 Pro Max (430).
`--shm-size=1g` hace falta: con los 64 MB de siempre el navegador se cae a
mitad de camino. La versión de la imagen y la de `playwright` tienen que ser
la misma.

### Chromium (Android) — local o en Docker

```
BROWSER=chromium PLAYWRIGHT_DIR=/tmp/pw BASE_URL=http://localhost:3100 npm run audit:mobile
```

Por defecto: Galaxy S8 (360) y Pixel 7 (412). En Docker es el mismo comando
de arriba con `-e BROWSER=chromium`.

### Variables

`BASE_URL` (obligatoria: sin ella sale con código 2), `BROWSER` (`webkit` | `chromium`), `DEVICES` (nombres de
`devices` separados por comas), `AUDIT_EMAIL` / `AUDIT_PASSWORD` (por defecto
la cuenta de `ux-seed.ts`), `AUDIT_TOURNAMENTS` (los torneos a recorrer, por
nombre), `SHOTS_DIR` / `SHOT_PREFIX` / `SHOT_THEMES` (capturas
`<prefijo>-<dispositivo>-<página>-<tema>.png`, sin `SHOTS_DIR` no saca
ninguna) y `ONLY` (sólo las escenas que contienen alguno de esos textos).

Contra `next dev` cada ruta se compila en la primera visita y la memoria
sube: correr un navegador por vez. Si el servidor se reinicia a mitad de
camino, el script espera y reintenta.
