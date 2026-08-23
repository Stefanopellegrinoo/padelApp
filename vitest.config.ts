import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./*"] — tsc resolves it for typecheck,
    // but Vitest needs its own alias to resolve it at test-run time.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // Las pantallas se testean renderándolas de verdad (`renderToStaticMarkup`),
  // y para eso hay que transformar el JSX de los `.tsx` que importan. El
  // `tsconfig.json` dice `jsx: "preserve"` porque el que compila la app es
  // Next; acá no hay quien lo haga después, así que se transforma al runtime
  // automático de React 19. Sin esto el `.tsx` sale con `React.createElement`
  // y sin `React` importado.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['core/**/*.test.ts', 'db/**/*.unit.test.ts', 'app/**/*.unit.test.ts'],
  },
})
