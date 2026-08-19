# scripts/

Scripts de navegador para este repo. Ninguno agrega una dependencia: todos
resuelven Playwright desde `PLAYWRIGHT_DIR` (`playwright.mjs`), no desde
`node_modules`. Ver el docblock de cada archivo para el detalle.

| Script | Qué hace |
|---|---|
| `playwright.mjs` | Cargador compartido de Chromium. No se corre solo. |
| `smoke.mjs` | Recorrido funcional end-to-end contra la base. |
| `ux-seed.ts` | Siembra la escena para medir feedback táctil (`npx tsx scripts/ux-seed.ts`). |
| `ux-measure.mjs` | Mide `T_first_visible_change_ms` de 23 toques y compara contra `ux-baseline.json`. |

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
