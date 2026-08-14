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
