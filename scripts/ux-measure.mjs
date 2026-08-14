/**
 * Medición de "feedback inmediato al tocar" — Fase 0 de ese cambio.
 *
 * Recorre 23 interacciones táctiles con ~250ms de latencia simulada y mide,
 * para cada una, dos números contra el mismo reloj:
 *   T_first_visible_change_ms: ms del toque al primer píxel distinto en pantalla
 *   T_complete_ms:              ms del toque a que la interacción se da por terminada
 *
 * El overlay de dev de Next 15 (`<nextjs-portal>`) reacciona al instante a
 * CUALQUIER acción/ruta pendiente, la haga visible la app o no — invisible en
 * producción, y en una primera pasada sin suprimirlo TODAS las interacciones
 * medían 50-90ms y el bug quedaba invisible. Por eso `page.addInitScript` lo
 * esconde acá (sólo del lado del test, sin tocar código de la app): sin esto,
 * cada número de este script es ficción.
 *
 * Cómo correrlo:
 *
 *   npm run db:reset && npx tsx scripts/ux-seed.ts   # arma la escena
 *   npm run dev                                       # en otra terminal
 *   node scripts/ux-measure.mjs
 *
 * Si existe `scripts/ux-baseline.json`, al final imprime una tabla
 * label | baseline | ahora | delta y sale con código 1 si alguna interacción
 * empeoró. Sin baseline (la primera corrida, Fase 0), sólo mide y sale 0.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { launchChromium } from './playwright.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const OUT_DIR = '.ux'
const SCREENS = `${OUT_DIR}/screens`
const BASELINE_FILE = 'scripts/ux-baseline.json'
mkdirSync(SCREENS, { recursive: true })

const seed = JSON.parse(readFileSync(`${OUT_DIR}/seed-output.json`, 'utf8'))

const results = []
const consoleErrors = []

function ariaBusyGone(page) {
  return page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, {
    timeout: 15000,
  })
}

// textContent, no innerText: varios labels ("¿Quién ganó?", "Paso N de 5")
// son CSS text-transform:uppercase, e innerText refleja esa transformación —
// una búsqueda en minúscula/mayúscula mixta nunca matchearía. textContent
// ignora el CSS por completo.
function bodyIncludes(page, text) {
  return page.waitForFunction((t) => document.body.textContent.includes(t), text, { timeout: 10000 })
}

function bodyExcludes(page, text) {
  return page.waitForFunction((t) => !document.body.textContent.includes(t), text, { timeout: 10000 })
}

/**
 * Toca un botón y prueba que el servidor PERSISTIÓ el cambio, no sólo que la
 * pantalla contestó rápido. Con el tilde optimista de `armado.tsx`, el DOM ya
 * puede decir `expectedText` antes de que el servidor conteste — mirar el DOM
 * ahí ya no prueba nada. Y el cuerpo del propio POST tampoco sirve: el flight
 * de RSC serializa `{confirmed} confirmados` como DOS hijos separados (`7` y
 * `" confirmados"`), así que el substring armado nunca aparece literal ahí
 * adentro aunque el dato SÍ se haya guardado — se probó y rompe siempre.
 *
 * La única prueba que no depende del formato interno de Next es recargar: una
 * navegación completa (GET, HTML de verdad) tira cualquier estado optimista y
 * de router, y en HTML dos hijos de texto adyacentes SÍ quedan concatenados.
 * Si el texto esperado no aparece después de la recarga, tira: una aserción
 * que nunca falla no es una aserción.
 */
async function assertPersisted(page, buttonText, expectedText) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
    page.locator('button', { hasText: buttonText }).click(),
  ])
  await page.reload({ waitUntil: 'networkidle' })
  await bodyIncludes(page, expectedText)
}

/**
 * Corre una interacción, midiendo dos cosas contra el mismo Date.now():
 * - el primer diff de píxeles en pantalla (screenshots por sondeo, comparación exacta de bytes)
 * - la resolución propia de runFn (cada escenario define qué significa "listo" para él)
 */
async function measureInteraction(page, label, runFn) {
  console.log(`\n=== ${label} ===`)
  let baseline = null
  try {
    baseline = await page.screenshot()
  } catch (e) {
    console.log(`  (falló el screenshot base: ${e.message})`)
  }

  const checkpoints = [
    20, 40, 60, 80, 100, 120, 150, 180, 220, 260, 300, 350, 400, 500, 600, 750, 900, 1100, 1400,
    1800, 2300, 3000,
  ]
  const tStart = Date.now()
  let firstChangeAt = null
  let shot100 = null

  const diffLoop = (async () => {
    for (const cp of checkpoints) {
      const waitMs = tStart + cp - Date.now()
      if (waitMs > 0) {
        try {
          await page.waitForTimeout(waitMs)
        } catch {
          break
        }
      }
      let shot
      try {
        shot = await page.screenshot()
      } catch {
        continue // la página está a mitad de navegación; se salta este tick
      }
      if (shot100 === null && cp === 100) shot100 = shot
      if (firstChangeAt === null && baseline !== null && !shot.equals(baseline)) {
        firstChangeAt = Date.now() - tStart
      }
      if (Date.now() - tStart > 4200) break
    }
  })()

  let completedAt = null
  let runError = null
  try {
    await runFn()
    completedAt = Date.now() - tStart
  } catch (e) {
    runError = e.message
  }

  await diffLoop

  const entry = {
    label,
    T_first_visible_change_ms: firstChangeAt,
    T_complete_ms: completedAt,
    error: runError,
  }
  results.push(entry)
  console.log(`  T_first_visible_change=${firstChangeAt}ms  T_complete=${completedAt}ms  error=${runError ?? 'none'}`)

  if (shot100) {
    const fname = `${SCREENS}/${String(results.length).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}-100ms.png`
    writeFileSync(fname, shot100)
    entry.screenshot_100ms = fname
  }
  return entry
}

/**
 * El gate es un TECHO ABSOLUTO, no una comparación contra el baseline.
 *
 * Comparar deltas acá no mide la app, mide el instrumento. Los checkpoints van
 * de 20 en 20ms (línea 72) y cada `page.screenshot()` cuesta ~30ms, así que un
 * toque que responde "enseguida" cae siempre en 50, 82, 86 o 100 — nunca en un
 * valor intermedio. Un control parado en el borde de un escalón salta ±30ms
 * entre dos corridas idénticas: medido, `14-cerrar-fecha` dio 51ms y 82ms en
 * dos corridas limpias consecutivas sobre el MISMO commit. Ninguna tolerancia
 * más fina que el escalón puede distinguir eso de una regresión, y un gate que
 * falla sobre código sin cambios enseña a ignorarlo.
 *
 * Lo que el contrato pide tampoco es "no varió": es que el toque se conteste
 * rápido. 150ms está muy por debajo de lo que este bug producía (300-800ms de
 * pantalla muerta) y muy por encima del escalón del instrumento, así que sólo
 * se enciende cuando algo se rompió de verdad. El delta contra el baseline
 * queda en la tabla como información — que es para lo que sirve.
 */
const RESPONSIVE_CEILING_MS = 150

function printComparison() {
  if (!existsSync(BASELINE_FILE)) {
    console.log(`\n(sin ${BASELINE_FILE} — nada para comparar, esta corrida ES el baseline)`)
    return 0
  }
  const baselineResults = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).results
  const baselineByLabel = new Map(baselineResults.map((r) => [r.label, r.T_first_visible_change_ms]))

  console.log(`\n=== Comparación vs baseline (T_first_visible_change_ms, techo ${RESPONSIVE_CEILING_MS}ms) ===`)
  console.log('label'.padEnd(38), 'baseline'.padStart(10), 'ahora'.padStart(10), 'delta'.padStart(10))
  let overCeiling = 0
  let broken = 0
  for (const r of results) {
    const before = baselineByLabel.get(r.label)
    const after = r.T_first_visible_change_ms
    const delta = before != null && after != null ? after - before : null
    // No medir es peor que medir lento: una interacción que no corrió no
    // demuestra nada, así que cuenta como fallo y no como fila vacía.
    const slow = after !== null && after > RESPONSIVE_CEILING_MS
    if (slow) overCeiling++
    if (r.error || after === null) broken++
    const line = [
      r.label.padEnd(38),
      String(before ?? '—').padStart(10),
      String(after ?? '—').padStart(10),
      (delta === null ? '—' : (delta > 0 ? '+' : '') + delta).padStart(10) + (slow ? '  ⚠ LENTO' : ''),
    ].join(' ')
    // Un run puede haber caído en un error (ej. redirect a /login por sesión
    // caída) y aun así dejar un T_first_visible_change_ms de aspecto legítimo
    // — sin esto, un número limpio en la tabla podía esconder un run roto.
    console.log(r.error ? `${line}  ⚠ ERROR: ${r.error}` : line)
  }
  if (overCeiling === 0 && broken === 0) {
    console.log(`\nLas ${results.length} interacciones contestan por debajo de ${RESPONSIVE_CEILING_MS}ms.`)
    return 0
  }
  if (overCeiling > 0) console.log(`\n${overCeiling} interacción(es) por encima del techo de ${RESPONSIVE_CEILING_MS}ms.`)
  if (broken > 0) {
    console.log(
      `${broken} interacción(es) no se pudieron medir. Casi siempre es la escena consumida:` +
        ` este script CIERRA fechas y arma parejas, así que hay que correr` +
        ` \`npm run db:reset\` + \`ux-seed.ts\` ANTES DE CADA corrida.`,
    )
  }
  return 1
}

async function main() {
  const browser = await launchChromium({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  // Ver el docblock de arriba: sin esto, todo mide "rápido" y el bug es invisible.
  await page.addInitScript(() => {
    function hide() {
      const el = document.querySelector('nextjs-portal')
      if (el) el.style.setProperty('display', 'none', 'important')
    }
    // addInitScript corre al inicio del documento: documentElement puede seguir
    // siendo null en el instante en que esto se ejecuta, antes de que el parser
    // produzca <html>.
    function start() {
      if (!document.documentElement) {
        setTimeout(start, 0)
        return
      }
      hide()
      new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true })
    }
    start()
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), url: page.url(), at: new Date().toISOString() })
    }
  })
  page.on('pageerror', (err) => {
    consoleErrors.push({ text: `pageerror: ${err.message}`, url: page.url(), at: new Date().toISOString() })
  })

  // ~250ms de latencia agregada en cada request, ancho de banda sin límite.
  // Se aplica una vez y persiste en esta sesión CDP/página para toda la corrida.
  const client = await context.newCDPSession(page)
  await client.send('Network.enable')
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 250,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  // ---- Priming (sin medir): la compilación de rutas de Next dev se paga acá,
  // no dentro de un número medido. Sólo se miden tiempos en estado estable.
  console.log('Priming routes (sin medir)...')
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' }).catch((e) => console.log('prime /login', e.message))

  // ================= 1) Login submit =================
  await page.fill('#email', seed.admin.email)
  await page.fill('#password', seed.password)
  await measureInteraction(page, '01-login-submit', async () => {
    await Promise.all([
      page.waitForURL('**/torneos', { timeout: 20000 }),
      page.getByRole('button', { name: 'Entrar' }).click(),
    ])
    await ariaBusyGone(page)
  })

  // Priming del resto de las rutas GET autenticadas, sin medir.
  const closeUrl = seed.closeFlow.url
  const closeBase = closeUrl.replace('/fechas/1', '')
  for (const url of [
    seed.draft.url,
    seed.guestDraft.url,
    seed.redraft.url,
    closeUrl,
    `${closeBase}/fechas`,
    `${closeBase}/stats`,
    `${closeBase}/reglas`,
    `${BASE}/torneos/nuevo`,
  ]) {
    await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => console.log(`prime ${url}`, e.message))
  }

  // ================= 2) Toggle de asistencia (fecha en borrador) =================
  // El tilde de asistencia es optimista (armado.tsx): apenas se toca, el DOM ya
  // puede leer "7 confirmados" ANTES de que el servidor conteste — eso hace
  // que `bodyIncludes` por sí solo ya no pruebe que la escritura llegó a la
  // base, sólo que la pantalla contestó. Lo que sí lo prueba es el CUERPO de
  // la respuesta del POST: `revalidatePath` hace que el RSC actualizado viaje
  // adentro de esa misma respuesta, así que leerlo demuestra persistencia real.
  await page.goto(seed.draft.url, { waitUntil: 'networkidle' })
  await measureInteraction(page, '02-attendance-toggle-off', async () => {
    await assertPersisted(page, 'Jugador de test 1', '7 confirmados')
  })
  await measureInteraction(page, '03-attendance-toggle-on', async () => {
    await assertPersisted(page, 'Jugador de test 1', '8 confirmados')
  })

  // ================= 3) Generar parejas / Regenerar =================
  await measureInteraction(page, '04-generar-parejas', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('button', { hasText: 'Generar parejas' }).click(),
    ])
    await bodyIncludes(page, 'Confirmar fecha')
  })
  await measureInteraction(page, '05-regenerar', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('button', { hasText: 'Regenerar' }).click(),
    ])
  })

  // ================= 4) Confirmar fecha =================
  await measureInteraction(page, '06-confirmar-fecha', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('button', { hasText: 'Confirmar fecha' }).click(),
    ])
    await bodyExcludes(page, 'Confirmar fecha')
  })

  // ================= 5) Controles de invitado (fecha separada, en borrador) =====
  await page.goto(seed.guestDraft.url, { waitUntil: 'networkidle' })
  await measureInteraction(page, '07-agregar-pareja-invitada', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('button', { hasText: 'Agregar pareja invitada' }).click(),
    ])
    await page.waitForSelector('[aria-label="Sacar la pareja invitada"]', { timeout: 10000 })
  })
  await page.locator('input[placeholder="Nombre"]').first().fill('Invitado Uno')
  await measureInteraction(page, '08-nombrar-invitado-blur', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('h2', { hasText: 'Parejas invitadas' }).click(),
    ])
  })

  // ================= 6) Volver al armado + confirmar (fecha para rehacer) =====
  await page.goto(seed.redraft.url, { waitUntil: 'networkidle' })
  await measureInteraction(page, '09-volver-al-armado-open-panel', async () => {
    await page.locator('button', { hasText: 'Volver al armado' }).click()
    await bodyIncludes(page, 'Volvés al armado para corregir')
  })
  await measureInteraction(page, '10-volver-al-armado-confirm', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('button', { hasText: 'Volver al armado' }).click(),
    ])
    await bodyIncludes(page, 'Quién viene')
  })

  // ================= 7) Cargar resultado + Cerrar fecha =================
  await page.goto(closeUrl, { waitUntil: 'networkidle' })
  // El toggle "Cargar resultado" se dibuja en cada tarjeta de partido, cargado
  // o no (ver comentario en carga.tsx), así que el texto solo no elige la
  // correcta. Todo partido sin cargar muestra '–' en ambos scores
  // (page.tsx: scoreA/scoreB), así que se acota a esa tarjeta específica.
  // exact: true importa acá — la línea resumen de la ronda colapsada también
  // contiene un '–' literal dentro de un string más largo ("PairA 4–1 PairB"),
  // así que una búsqueda por substring agarraría la tarjeta equivocada. El
  // chip de score sin resolver tiene como texto completo exactamente '–'.
  const openMatchCard = page
    .getByText('–', { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")][1]')
  await measureInteraction(page, '11-cargar-resultado-open', async () => {
    await openMatchCard.locator('button', { hasText: 'Cargar resultado' }).click()
    await bodyIncludes(page, 'Quién ganó')
  })
  await measureInteraction(page, '12-quien-gano-tap', async () => {
    await page
      .locator('xpath=//p[contains(text(),"¿Quién ganó?")]/following-sibling::div[1]//button[1]')
      .click()
    await bodyIncludes(page, 'Games del perdedor')
  })
  await measureInteraction(page, '13-games-del-perdedor-save', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page
        .locator('xpath=//p[contains(text(),"Games del perdedor")]/following-sibling::div[1]//button[1]')
        .click(),
    ])
  })
  await measureInteraction(page, '14-cerrar-fecha', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }),
      page.locator('button', { hasText: 'Cerrar fecha' }).click(),
    ])
    await bodyIncludes(page, 'Reabrir fecha')
  })

  // ================= 8) Pestañas de la nav =================
  await page.goto(closeBase, { waitUntil: 'networkidle' })
  const tabs = [
    ['Fechas', `${closeBase}/fechas`],
    ['Stats', `${closeBase}/stats`],
    ['Reglas', `${closeBase}/reglas`],
    ['Tabla', closeBase],
  ]
  let navIdx = 15
  for (const [name, url] of tabs) {
    await measureInteraction(page, `${navIdx}-nav-${name.toLowerCase()}`, async () => {
      await page.getByRole('link', { name }).first().click()
      await page.waitForURL((u) => u.toString() === url || u.toString() === `${url}/`, { timeout: 10000 })
      await ariaBusyGone(page)
    })
    navIdx++
  }

  // ================= 9) Wizard de creación de torneo =================
  await page.goto(`${BASE}/torneos/nuevo`, { waitUntil: 'networkidle' })
  await page.fill('input[placeholder="Los Jueves 2026"]', `UX Wizard ${Date.now()}`)
  await measureInteraction(page, '19-wizard-step0-continuar', async () => {
    await page.locator('button', { hasText: 'Continuar' }).click()
    await bodyIncludes(page, 'Paso 2 de 5')
  })

  const nameInputs = page.locator('input[placeholder="Nombre"]')
  const count = await nameInputs.count()
  for (let i = 0; i < count; i++) {
    await nameInputs.nth(i).fill(`Wizard P${i + 1}`)
  }
  await measureInteraction(page, '20-wizard-step1-continuar', async () => {
    await page.locator('button', { hasText: 'Continuar' }).click()
    await bodyIncludes(page, 'Paso 3 de 5')
  })

  await measureInteraction(page, '21-wizard-step2-continuar', async () => {
    await page.locator('button', { hasText: 'Continuar' }).click()
    await bodyIncludes(page, 'Paso 4 de 5')
  })

  await page.locator('button', { hasText: 'Usar los defaults' }).click()
  await measureInteraction(page, '22-wizard-step3-continuar-submit', async () => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 15000 }),
      page.locator('button', { hasText: 'Continuar' }).click(),
    ])
    await bodyIncludes(page, 'Link de invitación')
  })

  await measureInteraction(page, '23-wizard-ir-al-torneo', async () => {
    await page.locator('button', { hasText: 'Ir al torneo' }).click()
    await page.waitForURL(/\/torneo\/[0-9a-f-]+$/, { timeout: 15000 })
    await ariaBusyGone(page)
  })

  writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({ results, consoleErrors }, null, 2))
  console.log('\n\n=== LISTO. Resultados en .ux/results.json ===')

  await browser.close()

  const exitCode = printComparison()
  if (consoleErrors.length > 0) {
    console.log(`\n=== Errores de consola vistos (${consoleErrors.length}) ===`)
    console.log(JSON.stringify(consoleErrors, null, 2))
  }
  process.exit(exitCode)
}

main().catch((err) => {
  console.error('FATAL', err)
  process.exit(1)
})
