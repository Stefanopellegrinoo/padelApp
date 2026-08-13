/**
 * Cargador compartido de Playwright para los scripts de `scripts/`.
 *
 * Playwright no está en el proyecto y no tiene que estar (ver docblock de
 * `smoke.mjs`). Se instala aparte, en `PLAYWRIGHT_DIR` (por defecto
 * `/tmp/smoke`), y este módulo lo resuelve desde ahí con `createRequire` en
 * vez de un `import` normal — así ni Node ni el bundler lo buscan en
 * `node_modules` del repo.
 *
 *   mkdir -p /tmp/smoke && (cd /tmp/smoke && npm i playwright-core)
 *   npx playwright install chromium   # una vez, deja el binario en el cache
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PLAYWRIGHT_DIR = process.env.PLAYWRIGHT_DIR ?? '/tmp/smoke'

function chromePath() {
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(cache)) throw new Error(`No hay navegadores en ${cache}. Corré: npx playwright install chromium`)
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
  for (const build of builds.reverse()) {
    const binary = join(cache, build, 'chrome-linux64', 'chrome')
    if (existsSync(binary)) return binary
  }
  throw new Error(`No encontré el binario de chromium en ${cache}`)
}

/** Lanza Chromium resuelto desde `PLAYWRIGHT_DIR`, con el binario del cache local. */
export async function launchChromium(options = {}) {
  const require = createRequire(join(PLAYWRIGHT_DIR, 'index.js'))
  const { chromium } = require('playwright-core')
  return chromium.launch({ executablePath: chromePath(), ...options })
}
