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

`ux-baseline.json` queda commiteado como referencia: cada corrida posterior
imprime `label | baseline | ahora | delta` y sale con código 1 si alguna de
las 23 interacciones empeoró.
