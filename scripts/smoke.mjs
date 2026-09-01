/**
 * El recorrido con navegador — Task 14 del Plan 4.
 *
 * Es un script, no una suite: sin framework, sin fixtures y sin una dependencia
 * nueva en `package.json`. Recorre la app como la recorre una persona y, en
 * cada paso, pregunta dos cosas: si la pantalla respondió, y si lo que dice
 * coincide con lo que hay en la base. La segunda es la que encuentra cosas —
 * los cinco defectos del Plan 3 eran pantallas que respondían 200 y mentían.
 *
 * Cómo correrlo:
 *
 *   npm run db:reset          # `npm run test:db` deja temporadas basura
 *   npm run dev               # en otra terminal
 *   node scripts/smoke.mjs
 *
 * Playwright no está en el proyecto y no tiene que estar. Se instala aparte:
 *
 *   mkdir -p /tmp/smoke && (cd /tmp/smoke && npm i playwright-core)
 *   PLAYWRIGHT_DIR=/tmp/smoke node scripts/smoke.mjs
 *
 * El navegador sale de la caché de Playwright (`~/.cache/ms-playwright`). Si no
 * hay ninguno, `npx playwright install chromium` lo baja.
 */
import { execFileSync } from 'node:child_process'
import { launchChromium } from './playwright.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const EMAIL = 'admin@demo.com'
const PASSWORD = 'demodemo'

/** Una consulta a la base, como texto. Es la fuente de verdad contra la que se compara la pantalla. */
function query(sql) {
  return execFileSync('psql', [DB, '-tAc', sql], { encoding: 'utf8' }).trim()
}

let failures = 0
let step = 0

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}`)
    return true
  }
  failures++
  console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  return false
}

function heading(title) {
  step++
  console.log(`\n${step}. ${title}`)
}

/** Navega y asierta que la respuesta fue 200. `networkidle` porque el submit queda deshabilitado hasta que React hidrata. */
async function go(page, path) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  check(`GET ${path} responde 200`, response !== null && response.status() === 200, `status ${response?.status()}`)
  return response
}

async function main() {
  const browser = await launchChromium()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()

  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} en ${response.url()}`)
  })

  // ── 1. Landing sin sesión ──────────────────────────────────────────────────
  heading('Landing sin sesión')
  await go(page, '/')

  // ── 2. Login ───────────────────────────────────────────────────────────────
  heading('Login con las credenciales del seed')
  await go(page, '/login')
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await Promise.all([page.waitForURL(`${BASE}/torneos`, { timeout: 15000 }), page.click('button[type="submit"]')])
  check('después de entrar cae en /torneos', page.url() === `${BASE}/torneos`, page.url())

  // ── 3. Mis torneos ─────────────────────────────────────────────────────────
  heading('Mis torneos lista la temporada demo')
  const demoName = query(`select name from public.seasons where invite_token = 'demo'`)
  const demoId = query(`select id from public.seasons where invite_token = 'demo'`)
  check('la base tiene la temporada del seed', demoName !== '', demoName)
  // `go` y no `page.content()` a secas: el `waitForURL` del login matchea en
  // cuanto cambia la URL, ANTES de que el Server Component de /torneos haya
  // terminado de renderizar — así que el contenido llegaba vacío y este check
  // fallaba SIEMPRE. Falso positivo de las dos ramas, medido: la pantalla sí
  // lista la temporada. Un tripwire que falla por su propia carrera enseña a
  // ignorarlo, que es el mismo argumento con el que
  // `db/discipline.db.test.ts` defiende contar del lado de Postgres.
  await go(page, '/torneos')
  check(
    `la pantalla nombra "${demoName}"`,
    (await page.content()).includes(demoName),
    'la temporada del seed no aparece en la lista',
  )

  // ── 4. Crear un torneo de 8 ────────────────────────────────────────────────
  heading('Crear un torneo nuevo de 8, hasta el paso 5')
  const seasonName = `Smoke ${new Date().toISOString().slice(11, 19)}`
  const squad = ['Ana', 'Bruno', 'Caro', 'Diego', 'Emi', 'Fede', 'Gaby', 'Hernán']
  await go(page, '/torneos/nuevo')
  await page.fill('input[placeholder="Los Jueves 2026"]', seasonName)
  await page.getByRole('button', { name: 'Continuar' }).click()

  const seats = page.locator('input[placeholder="Nombre"]')
  for (const [index, name] of squad.entries()) await seats.nth(index).fill(name)
  await page.getByRole('button', { name: 'Continuar' }).click() // → orden inicial
  await page.getByRole('button', { name: 'Continuar' }).click() // → formato
  await page.getByRole('button', { name: 'Continuar' }).click() // → submit

  await page.getByRole('button', { name: 'Ir al torneo' }).waitFor({ timeout: 15000 })
  const seasonId = query(`select id from public.seasons where name = '${seasonName}'`)
  check('la temporada quedó creada en la base', seasonId !== '', 'no hay fila en `seasons`')
  check(
    'con sus ocho asientos de plantel',
    query(`select count(*) from public.entries where season_id = '${seasonId}' and kind = 'SQUAD'`) === '8',
    query(`select count(*) from public.entries where season_id = '${seasonId}' and kind = 'SQUAD'`),
  )

  // ── 5. Abrir la fecha 1 ────────────────────────────────────────────────────
  heading('Abrir la fecha 1')
  //Antes apuntaba al stub sin disciplina —
  // pasaba (el meta refresh de 1s alcanza a resolver antes de `networkidle`)
  // pero el `200` que `check()` asertaba era el del stub, no el de la lista.
  // El wizard de este script crea una sola disciplina PADEL (sin picker de
  // disciplinas), así que el slug es 'padel'.
  await go(page, `/torneo/${seasonId}/padel/fechas`)
  const openCta = page.getByRole('button', { name: 'Abrir fecha 1' })
  check('el CTA dice el número que va a tener la fecha', (await openCta.count()) === 1)
  await openCta.click()
  await page.waitForTimeout(1500)
  const matchdayId = query(`select id from public.matchdays where season_id = '${seasonId}' and number = 1`)
  check('la fecha 1 existe y está en DRAFT', matchdayId !== '' && query(`select status from public.matchdays where id = '${matchdayId}'`) === 'DRAFT')

  // ── 6. Dejar 7 confirmados ────────────────────────────────────────────────
  heading('Tildar: dejar 7 y ver aparecer al invitado')
  await go(page, `/torneo/${seasonId}/padel/fechas/1`)
  check('el panel arranca con los 8 del plantel', (await page.getByText('8 confirmados').count()) === 1)
  await page.getByRole('button', { name: squad[7] }).click()
  await page.waitForTimeout(1500)
  check('el panel dice 7 confirmados', (await page.getByText('7 confirmados').count()) === 1)
  // Este check esperaba `'Son impares. Se suma 1 invitado y la fecha queda de
  // 8.'` y fallaba SIEMPRE. Medido dumpeando el panel: ese texto no está ni en
  // el DOM (`count === 0`). Es el copy de un estado TRANSITORIO —el de
  // `needsLooseGuest`, entre destildar y que el invitado aparezca— y para
  // cuando el script mira, `syncGuestSeat` ya lo agregó y el panel pasó a la
  // rama completa: `'La fecha es de 8 · 4 parejas · 6 partidos'`.
  //
  // O sea: no era una carrera ni un problema de visibilidad, era un copy
  // obsoleto. Se afirma lo que el paso dice probar ("dejar 7 y ver aparecer al
  // invitado") contra lo que la pantalla dice HOY, y se espera el ESTADO en
  // vez de confiar en el `waitForTimeout` de arriba.
  const fechaDeOcho = page.getByText('La fecha es de 8', { exact: false })
  await fechaDeOcho.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
  check('y la fecha vuelve a quedar de 8 con el invitado adentro', await fechaDeOcho.isVisible())
  check(
    'la base agregó el asiento de invitado',
    query(`select count(*) from public.entries where matchday_id = '${matchdayId}' and kind = 'GUEST'`) === '1',
  )

  // ── 7. Nombrar, generar, confirmar ────────────────────────────────────────
  heading('Nombrar al invitado, generar parejas y confirmar')
  const guestInput = page.locator('section.border-dashed input')
  await guestInput.fill('Invitado Smoke')
  await guestInput.blur()
  await page.waitForTimeout(1500)
  check(
    'el invitado quedó con nombre en la base',
    query(`select display_name from public.entries where matchday_id = '${matchdayId}' and kind = 'GUEST'`) === 'Invitado Smoke',
  )

  await page.getByRole('button', { name: 'Generar parejas' }).click()
  await page.waitForTimeout(2000)
  check(
    'se sortearon 4 parejas',
    query(`select count(*) from public.pairs where matchday_id = '${matchdayId}'`) === '4',
    query(`select count(*) from public.pairs where matchday_id = '${matchdayId}'`),
  )
  check(
    'y su fixture de 6 partidos',
    query(`select count(*) from public.matches where matchday_id = '${matchdayId}'`) === '6',
    query(`select count(*) from public.matches where matchday_id = '${matchdayId}'`),
  )

  await page.getByRole('button', { name: 'Confirmar fecha' }).click()
  await page.waitForTimeout(2000)
  check(
    'la fecha quedó OPEN',
    query(`select status from public.matchdays where id = '${matchdayId}'`) === 'OPEN',
    query(`select status from public.matchdays where id = '${matchdayId}'`),
  )

  // ── 8. Cargar los 6 resultados y cerrar ───────────────────────────────────
  heading('Cargar los 6 resultados en dos toques y cerrar la fecha')
  for (let loaded = 0; loaded < 6; loaded++) {
    await go(page, `/torneo/${seasonId}/padel/fechas/1`)
    // Con 4 parejas el fixture son 3 rondas de 2, y el acordeón colapsa la ronda
    // completa: al recargar, los botones que quedan a la vista son los de las
    // rondas incompletas. Por eso el índice es `loaded % 2` y no `loaded`.
    await page.getByRole('button', { name: 'Cargar resultado' }).nth(loaded % 2).click()
    // Toque 1: gana la primera pareja. Toque 2: los games del perdedor.
    const panel = page.locator('div.mt-2', { hasText: '¿Quién ganó?' })
    await panel.waitFor({ timeout: 5000 })
    await panel.getByRole('button').nth(1).click()
    await page.getByText('Games del perdedor').waitFor({ timeout: 5000 })
    await page.getByRole('button', { name: String(loaded % 4), exact: true }).first().click()
    await page.waitForTimeout(1500)
  }
  const loadedMatches = query(
    `select count(*) from public.matches m where m.matchday_id = '${matchdayId}' and exists (select 1 from public.match_sets s where s.match_id = m.id)`,
  )
  check('los 6 partidos quedaron cargados', loadedMatches === '6', loadedMatches)

  await go(page, `/torneo/${seasonId}/padel/fechas/1`)
  const closeCta = page.getByRole('button', { name: 'Cerrar fecha', exact: true })
  check('el CTA de cerrar aparece sin el "faltan N"', (await closeCta.count()) === 1)
  await closeCta.click()
  await page.waitForTimeout(2500)
  check(
    'la fecha quedó CLOSED',
    query(`select status from public.matchdays where id = '${matchdayId}'`) === 'CLOSED',
    query(`select status from public.matchdays where id = '${matchdayId}'`),
  )
  // Siete y no ocho: jugaron ocho asientos, pero el invitado no cobra. Su
  // compañero sí, y por eso la pareja campeona deja UN award en `position: 1`.
  const awardCount = query(`select count(*) from public.awards where matchday_id = '${matchdayId}'`)
  check('y repartió un award por asiento del torneo, sin el invitado', awardCount === '7', awardCount)
  check(
    'el campeón cobró, aunque su pareja fuera el invitado',
    query(`select count(*) from public.awards where matchday_id = '${matchdayId}' and position = 1`) === '1',
  )
  check(
    'y el invitado no dejó ninguna fila de puntos',
    query(
      `select count(*) from public.awards a join public.entries e on e.id = a.entry_id
        where a.matchday_id = '${matchdayId}' and e.kind = 'GUEST'`,
    ) === '0',
  )

  // ── 9. La Tabla dice lo que dice la base ──────────────────────────────────
  heading('La Tabla muestra los puntos reales')
  await go(page, `/torneo/${seasonId}`)
  const champion = query(
    `select e.display_name from public.awards a join public.entries e on e.id = a.entry_id
      where a.matchday_id = '${matchdayId}' and a.position = 1 and e.kind = 'SQUAD' limit 1`,
  )
  const topPoints = query(`select max(points) from public.awards where matchday_id = '${matchdayId}'`)
  const tabla = await page.content()
  check(`la tabla nombra al campeón de la base (${champion})`, tabla.includes(champion), champion)
  check(`y muestra su puntaje (${topPoints})`, tabla.includes(`>${topPoints}<`), topPoints)
  check(
    'y aparece el botón de reabrir, porque es la última cerrada',
    await (async () => {
      await go(page, `/torneo/${seasonId}/padel/fechas/1`)
      return (await page.getByRole('button', { name: 'Reabrir fecha' }).count()) === 1
    })(),
  )

  // ── 10. Ajustes ───────────────────────────────────────────────────────────
  heading('Ajustes: cambiar el nombre y guardar texto de reglas')
  await go(page, `/torneo/${seasonId}/ajustes`)
  await page.fill('#nombre', 'Los Jueves 2026')
  await page.press('#nombre', 'Enter')
  await page.waitForTimeout(2500)
  check(
    'el nombre nuevo está en la base',
    query(`select name from public.seasons where id = '${seasonId}'`) === 'Los Jueves 2026',
    query(`select name from public.seasons where id = '${seasonId}'`),
  )

  await go(page, `/torneo/${seasonId}/ajustes`)
  // `.first()`: desde la rebanada 2 de "reglas por disciplina" Ajustes dibuja
  // UN textarea por disciplina. El torneo demo tiene una sola, así que hoy
  // esto es puro blindaje (`page.locator('textarea')` a secas ya quedaría
  // ambiguo en modo estricto en cuanto el demo sume una segunda).
  const rules = page.locator('textarea').first()
  await rules.fill('Se juega **los jueves** a las 20. <script>alert(1)</script>')
  await rules.blur()
  await page.waitForTimeout(2500)
  // `disciplines.rules_text`, no `seasons.rules_text` (0069): el escritor de
  // Ajustes se mudó de tabla en esta rebanada. `seasons.rules_text` sigue
  // recibiendo el mismo texto por el dual-write de `updateDisciplineRules`
  // mientras la disciplina editada sea la default —la única que existe acá—,
  // pero la columna que este check tiene que mirar es la nueva fuente real.
  check(
    'el texto de reglas quedó guardado',
    query(
      `select rules_text like '%los jueves%' from public.disciplines
        where season_id = '${seasonId}' order by position, created_at limit 1`,
    ) === 't',
  )
  check(
    'y la vista previa escapa el markdown del admin',
    !(await page.content()).includes('<script>alert(1)</script>'),
    'el script del admin llegó crudo al DOM',
  )

  // ── 11. Reglas sin sesión ─────────────────────────────────────────────────
  //
  // Este paso decía "salteado: es la Task 12 y está sin construir" hasta la
  // rebanada de arreglos de "reglas por disciplina". La Task 12 se construyó en
  // el Plan 4 y el salteo quedó mintiendo: el ÚNICO paso que mira la única
  // superficie pública de la app estaba apagado por un motivo vencido.
  //
  // Y es el paso que más falta hacía. La rama anónima no lee `seasons` sino dos
  // funciones `security definer`, así que es la que se rompe sin que ninguna
  // otra pantalla se entere: `0069` hace `drop function` sobre
  // `season_public_formats` y la vuelve a crear, y si el `grant` de después se
  // olvidara, TODO ESTO daría error mientras la app con sesión sigue perfecta.
  // `psql` puede probar el grant; esto prueba la pantalla.
  heading('Reglas sin login')
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const anonPage = await anon.newPage()
  anonPage.on('pageerror', (error) => errors.push(`[anon] ${String(error)}`))
  anonPage.on('response', (response) => {
    if (response.status() >= 500) errors.push(`[anon] ${response.status()} en ${response.url()}`)
  })

  await go(anonPage, `/torneo/${seasonId}/reglas`)
  const anonHtml = await anonPage.content()

  check('el texto que escribió quien organiza se ve sin cuenta', anonHtml.includes('los jueves'))
  check(
    'y su <script> sigue escapado para un extraño',
    !anonHtml.includes('<script>alert(1)</script>'),
    'el script del admin llegó crudo al DOM anónimo',
  )
  // La prosa generada es lo que prueba que `season_public_formats` sirvió las
  // seis columnas: sin `has_masters`/`pair_size`/`allows_draw` el `shape` llega
  // incompleto y `narrateRules` no puede armar estas filas.
  check(
    'y la prosa generada llega entera, no sólo el texto libre',
    ['Puntos por posición', 'Orden de desempate', 'Masters'].every((row) => anonHtml.includes(row)),
    'falta alguna fila del acordeón: el shape de la disciplina no llegó completo',
  )

  // El resto del torneo NO se abre sin cuenta: Reglas es la excepción, no la
  // regla. Si esto empieza a devolver 200 con contenido, se filtró el torneo.
  const tablaAnon = await anonPage.goto(`${BASE}/torneo/${seasonId}`, { waitUntil: 'networkidle' })
  check(
    'pero la Tabla del mismo torneo manda a login',
    anonPage.url().includes('/login'),
    `terminó en ${anonPage.url()} con status ${tablaAnon?.status()}`,
  )

  await anon.close()

  // ── 12. Las cuatro pestañas, en claro y en oscuro ─────────────────────────
  heading('Las cuatro pestañas del torneo demo, en claro y en oscuro')
  // Este paso recorría los dos esquemas y sólo asertaba 200, así que la app
  // estuvo OSCURA SIEMPRE del 10/08 al 31/08 y el smoke pasó entero todos los
  // días. Un recorrido de temas que no compara un color prueba que las rutas
  // existen, no que el tema exista.
  const fondoDe = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const fondos = {}
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const tab of ['', '/fechas', '/stats', '/reglas']) {
      await go(page, `/torneo/${demoId}${tab}`)
    }
    fondos[scheme] = await fondoDe()
    console.log(`  · ${scheme} recorrido — fondo ${fondos[scheme]}`)
  }
  // El corazón del chequeo: que sean DISTINTOS. Da igual el valor exacto —
  // los tokens del handoff pueden cambiar— pero si los dos esquemas pintan el
  // mismo fondo, uno de los dos temas no se está sirviendo.
  check(
    'el tema claro y el oscuro pintan fondos distintos',
    fondos.light !== fondos.dark,
    `los dos dan ${fondos.light}: hay un solo tema sirviéndose`,
  )
  // Y que el claro sea CLARO, para que no pasen dos oscuros distintos.
  check(
    'y el claro es efectivamente claro',
    fondos.light === 'rgb(255, 255, 255)',
    `esperaba blanco y da ${fondos.light}`,
  )

  await browser.close()

  console.log('\n─────────────────────────────')
  if (errors.length > 0) {
    console.log(`Errores de página (${errors.length}):`)
    for (const error of errors.slice(0, 10)) console.log(`  ! ${error}`)
    failures += errors.length
  }
  console.log(failures === 0 ? 'El recorrido pasó entero.' : `${failures} aserciones fallaron.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
