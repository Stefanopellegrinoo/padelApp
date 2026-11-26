/**
 * Auditoría móvil de toda la app, con teléfonos emulados de verdad.
 *
 * Los chequeos de antes usaban Chromium de escritorio a un ancho de celular y
 * no veían lo que pasa en un teléfono: Safari agranda la pantalla al enfocar un
 * campo de menos de 16 px, y un `<input type="date">` nativo mide distinto en
 * iOS que en el escritorio. Este script usa los `devices` de Playwright
 * (isMobile, táctil, densidad y user agent de iPhone/Android) y recorre cada
 * pantalla y cada estado (hojas abiertas incluidas) buscando tres cosas:
 *
 *   overflow  algo se sale del ancho de la pantalla (o la página entera scrollea
 *             de costado). Lo que vive dentro de un carril con scroll propio
 *             (`overflow-x: auto`) no cuenta: está hecho para deslizarse.
 *   cut       un elemento queda cortado por un contenedor con `overflow: hidden`.
 *   clipped   un texto no entra en su caja (scrollWidth > clientWidth) sin ser
 *             un `text-overflow: ellipsis` a propósito.
 *   font      un campo (input, select, textarea, date y number incluidos) con
 *             letra de menos de 16 px: iOS hace zoom al enfocarlo.
 *   zoom      al enfocar un campo, `visualViewport.scale` deja de ser 1. (El
 *             WebKit de Playwright en Linux no reproduce el zoom de iOS al
 *             enfocar: este chequeo es una red; el que manda es `font`.)
 *   native-date  un `<input type="date">` nativo a la vista: en iOS no respeta
 *             el ancho. Va dentro de `CampoFecha` (`app/ui/campo-fecha.tsx`).
 *   broken-word  una palabra corta (un nombre) partida en dos renglones porque
 *             su columna no tiene lugar.
 *   overlap   dos textos (o un texto y una pieza chica pintada, como las
 *             rayitas de progreso) se pisan.
 *
 * Sale con código 1 si encuentra cualquier cosa (o si una escena no se pudo
 * recorrer), 0 si todo da cero. Cómo correrlo: ver `scripts/README.md`.
 *
 * Variables:
 *   BASE_URL       la app, obligatoria (ej. http://localhost:3000)
 *   BROWSER        webkit | chromium (por defecto webkit)
 *   DEVICES        lista separada por comas de nombres de `devices` de Playwright
 *   AUDIT_EMAIL / AUDIT_PASSWORD   la cuenta (por defecto la de `ux-seed.ts`)
 *   SHOTS_DIR      dónde guardar capturas (sin esto no saca ninguna)
 *   SHOT_PREFIX    prefijo de las capturas (por defecto `mobile-audit`)
 *   SHOT_THEMES    light, dark o light,dark (por defecto light)
 *   ONLY           sólo las escenas cuyo nombre contiene alguno de estos textos (separados por comas)
 *   PLAYWRIGHT_DIR carpeta con `node_modules/playwright` (o `playwright-core`)
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Sin valor por defecto a propósito: que nunca pegue sin querer a otro servidor que el que se eligió.
const BASE = process.env.BASE_URL
if (!BASE) {
  console.error('Falta BASE_URL (por ejemplo BASE_URL=http://localhost:3000). Ver scripts/README.md.')
  process.exit(2)
}
const BROWSER = process.env.BROWSER ?? 'webkit'
const DEFAULT_DEVICES = {
  webkit: ['iPhone SE', 'iPhone 13', 'iPhone 14 Pro Max'],
  chromium: ['Galaxy S8', 'Pixel 7'],
}
const DEVICES = (process.env.DEVICES ?? DEFAULT_DEVICES[BROWSER].join(',')).split(',').map((d) => d.trim())
const EMAIL = process.env.AUDIT_EMAIL ?? 'ux-admin@padel-test.local'
const PASSWORD = process.env.AUDIT_PASSWORD ?? 'test-password-not-for-humans'
const SHOTS_DIR = process.env.SHOTS_DIR ?? ''
const SHOT_PREFIX = process.env.SHOT_PREFIX ?? 'mobile-audit'
const SHOT_THEMES = (process.env.SHOT_THEMES ?? 'light').split(',')
const ONLY = process.env.ONLY ?? ''

/** Los torneos de la escena local (`ux-seed.ts` y las tareas del rediseño), por nombre. */
const TOURNAMENTS = (
  process.env.AUDIT_TOURNAMENTS ??
  'Los Pibes del Martes|Fecha 2,Pádel con Masters,FIFA de los Viernes,FIFA con llave,Ping pong de la oficina,Pádel en armado,Ajedrez T2 68124,Bolos T3 50609,MD Tenis|Fecha,MD Pool,Viernes de pádel y FIFA'
).split(',')

function loadPlaywright() {
  const dir = process.env.PLAYWRIGHT_DIR ?? process.cwd()
  const require = createRequire(join(dir, 'noop.js'))
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return require(name)
    } catch {
      // probar el siguiente
    }
  }
  throw new Error(`No encontré playwright ni playwright-core en ${dir}/node_modules (PLAYWRIGHT_DIR)`)
}

const slug = (text) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Lo que mira en la página. Corre en el navegador: no puede usar nada de afuera.
 * Con una hoja abierta mira sólo la hoja (la página de atrás ya se miró sola).
 */
function inspect() {
  const vw = document.documentElement.clientWidth
  const out = []
  const dialog = document.querySelector('dialog[open]')
  const scope = dialog ?? document.body
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : ''
    const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ')
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${label.slice(0, 40)}"`
  }
  const hidden = (el) => {
    if (el.closest('dialog:not([open])')) return true
    const closed = el.closest('details:not([open])')
    if (closed && closed !== el && !el.closest('summary')) return true
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return true
    if (style.clip.startsWith('rect(0') || style.clipPath === 'inset(50%)') return true
    return false
  }
  const scroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const ox = getComputedStyle(node).overflowX
      if (ox !== 'visible') return { node, ox }
    }
    return null
  }

  if (!dialog && document.documentElement.scrollWidth > vw) {
    out.push({ kind: 'overflow', what: 'page', detail: `scrollWidth ${document.documentElement.scrollWidth} > ${vw}` })
  }

  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
    if (hidden(el)) continue
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    if (rect.right > vw + 1 || rect.left < -1) {
      const box = scroller(el)
      if (box === null) {
        out.push({ kind: 'overflow', what: describe(el), detail: `${Math.round(rect.left)}..${Math.round(rect.right)} de ${vw}` })
      } else if (box.ox === 'hidden' || box.ox === 'clip') {
        const outer = box.node.getBoundingClientRect()
        if (rect.right > outer.right + 1 || rect.left < outer.left - 1) {
          out.push({ kind: 'cut', what: describe(el), detail: `cortado por ${describe(box.node)}` })
        }
      }
    }
    const tag = el.tagName.toLowerCase()
    if (['input', 'select', 'textarea', 'button', 'svg', 'img'].includes(tag)) continue
    const ox = style.overflowX
    if (ox === 'auto' || ox === 'scroll') continue
    if (style.textOverflow === 'ellipsis') continue
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    if (ownText && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      out.push({ kind: 'clipped', what: describe(el), detail: `${el.scrollWidth} > ${el.clientWidth}` })
    }
  }

  // Lo que se pisa: renglones de texto y piezas chicas pintadas (puntos, rayitas)
  // de elementos distintos que no son uno ancestro del otro, en la misma capa
  // (lo fijo, como la barra de abajo, pasa por arriba del contenido a propósito).
  const layerOf = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position
      if (position === 'fixed' || position === 'sticky' || position === 'absolute') return node
    }
    return null
  }
  // Lo que se ve de un rectángulo: recortado por la propia caja y por cada
  // ancestro que no deja ver lo que se sale (un acordeón cerrado, un
  // line-clamp, un truncate). Los renglones de texto se achican arriba y abajo:
  // la caja de la fuente es más alta que las letras, y con interlineado
  // apretado (los números grandes) se tocan sin pisarse.
  const visible = (el, rect, isText) => {
    let box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    if (isText) {
      const trim = (box.bottom - box.top) * 0.2
      box.top += trim
      box.bottom -= trim
    }
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const r = node.getBoundingClientRect()
      box = {
        left: Math.max(box.left, r.left),
        right: Math.min(box.right, r.right),
        top: Math.max(box.top, r.top),
        bottom: Math.min(box.bottom, r.bottom),
      }
    }
    return box.right - box.left > 1 && box.bottom - box.top > 1 ? box : null
  }
  const pieces = []
  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('svg') || hidden(el)) continue
    const style = getComputedStyle(el)
    if (style.opacity === '0') continue
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim() !== '')
    if (texts.length > 0) {
      for (const text of texts) {
        const range = document.createRange()
        range.selectNodeContents(text)
        for (const line of range.getClientRects()) {
          const rect = visible(el, line, true)
          if (rect !== null) pieces.push({ el, rect, layer: layerOf(el) })
        }
      }
    } else if (el.children.length === 0 && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
      const own = el.getBoundingClientRect()
      const rect = own.width <= 64 && own.height <= 64 ? visible(el, own, false) : null
      if (rect !== null) pieces.push({ el, rect, layer: layerOf(el) })
    }
  }
  const seen = new Set()
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]
      const b = pieces[j]
      if (a.el === b.el || a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left)
      const hgt = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
      if (w >= 1 && hgt >= 1) {
        const key = describe(a.el) + describe(b.el)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ kind: 'overlap', what: describe(a.el), detail: `pisa a ${describe(b.el)}` })
      }
    }
  }

  // Palabras partidas al medio ("Mart / ín"): el texto no tiene lugar y el
  // navegador lo corta letra por letra. Lo que mide más de 14 letras sin
  // espacios (un mail, un ID, un número largo) no entra en ningún lado y se deja
  // cortar.
  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('svg') || hidden(el)) continue
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue
      const text = node.textContent
      for (const token of text.matchAll(/\S+/g)) {
        if (token[0].length > 14) continue
        for (const part of token[0].matchAll(/[^\-–/&·,.()]+/g)) {
          if (part[0].length < 2) continue
          const start = token.index + part.index
          const range = document.createRange()
          range.setStart(node, start)
          range.setEnd(node, start + part[0].length)
          const lines = [...range.getClientRects()].filter((r) => r.width > 0.5)
          const tops = new Set(lines.map((r) => Math.round(r.top)))
          if (tops.size > 1 && visible(el, range.getBoundingClientRect(), true) !== null) {
            out.push({ kind: 'broken-word', what: describe(el), detail: `"${part[0]}" partida en ${tops.size} renglones` })
          }
        }
      }
    }
  }

  const TEXT_TYPES = ['text', 'email', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'tel', 'search', 'url', '']
  for (const el of scope.querySelectorAll('input, select, textarea')) {
    if (el.tagName === 'INPUT' && !TEXT_TYPES.includes((el.getAttribute('type') ?? '').toLowerCase())) continue
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (size < 16) out.push({ kind: 'font', what: describe(el), detail: `${size}px` })
    // El selector de fecha nativo a la vista mide distinto en cada teléfono (en
    // iOS no respeta el ancho): va siempre dentro de `CampoFecha`, transparente.
    const type = (el.getAttribute('type') ?? '').toLowerCase()
    if (['date', 'time', 'datetime-local', 'month', 'week'].includes(type) && getComputedStyle(el).opacity !== '0') {
      out.push({ kind: 'native-date', what: describe(el), detail: 'campo de fecha nativo a la vista (usar CampoFecha)' })
    }
  }
  return out
}

/** Enfoca cada campo visible de la hoja abierta (o de la página) y mira si cambió la escala. */
async function focusCheck(page) {
  const findings = []
  const fields = await page.$$(
    'dialog[open] input, dialog[open] select, dialog[open] textarea, body:not(:has(dialog[open])) input, body:not(:has(dialog[open])) select, body:not(:has(dialog[open])) textarea',
  )
  for (const field of fields) {
    const info = await field.evaluate((el) => {
      const type = (el.getAttribute('type') ?? '').toLowerCase()
      if (['hidden', 'radio', 'checkbox', 'range', 'submit', 'button', 'file', 'color'].includes(type)) return null
      if (el.disabled || el.closest('dialog:not([open])')) return null
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return null
      const label = el.getAttribute('aria-label') ?? el.getAttribute('name') ?? el.id ?? type
      return { label: `${el.tagName.toLowerCase()}[${type}] "${label}"` }
    })
    if (info === null) continue
    await field.evaluate((el) => el.focus())
    await page.waitForTimeout(250)
    const scale = await page.evaluate(() => window.visualViewport?.scale ?? 1)
    await field.evaluate((el) => el.blur())
    if (Math.abs(scale - 1) > 0.01) findings.push({ kind: 'zoom', what: info.label, detail: `scale ${scale}` })
  }
  return findings
}

/** Corta lo que se cuelga (una página que no termina de cargar, un `evaluate` que no vuelve). */
function withTimeout(promise, ms, what) {
  let timer
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`se colgó: ${what} (${ms / 1000} s)`)), ms)
  })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

const { [BROWSER]: engine, devices } = loadPlaywright()
const all = []
let failed = false

for (const deviceName of DEVICES) {
  const device = devices[deviceName]
  if (!device) throw new Error(`Playwright no conoce el dispositivo "${deviceName}"`)
  const deviceSlug = slug(deviceName)
  const browser = await engine.launch()
  const context = await browser.newContext({ ...device, colorScheme: 'light', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' })
  // El link de invitación se copia al portapapeles: así se lee sin permisos.
  await context.addInitScript(() => {
    // El indicador de `next dev` (la "N" de abajo) no es parte de la app.
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal{display:none!important}'
      document.head.append(style)
    })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    const clip = { writeText: (text) => ((window.__copiado = text), Promise.resolve()), readText: () => Promise.resolve('') }
    Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  const findings = []
  let current = ''

  const h = {
    page,
    /**
     * Va a `path` y espera a que se quede quieta. Una navegación tardía de la
     * página anterior (el `router.replace` de después de iniciar sesión, por
     * ejemplo) puede cruzarse: si la página termina en otra ruta, se reintenta.
     * Las redirecciones de la propia ruta (a su deporte, o a iniciar sesión)
     * valen.
     */
    async go(path) {
      const want = path.split('?')[0]
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          await page.goto(BASE + path, { waitUntil: 'networkidle' })
        } catch (error) {
          const text = String(error)
          if (/Connection refused|ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(text) && attempt < 4) {
            // `next dev` se reinicia solo si se queda sin memoria: se le da tiempo.
            console.log(`  (sin servidor en ${BASE}, reintento en 30 s)`)
            await page.waitForTimeout(30000)
            continue
          }
          if (!text.includes('interrupted by another navigation')) throw error
        }
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(300)
        await page.waitForLoadState('networkidle')
        const landed = new URL(page.url()).pathname
        const toAuth = (landed === '/login' || landed === '/registro') && !/^\/(login|registro)/.test(want)
        if (landed.startsWith(want) || toAuth || want.endsWith('.html')) break
      }
      // Si `fonts.ready` no vuelve (pasa en WebKit a mitad de una navegación), se sigue igual.
      await withTimeout(page.evaluate(() => document.fonts.ready), 15000, 'las fuentes').catch(() => {})
    },
    /** Mira el estado actual: chequeos, enfoque de cada campo y capturas. */
    async check(name) {
      current = name
      await page.waitForTimeout(350) // la hoja termina de subir
      const found = await withTimeout(page.evaluate(inspect), 60000, `los chequeos de ${name}`)
      if (BROWSER === 'webkit') found.push(...(await focusCheck(page)))
      for (const f of found) findings.push({ device: deviceName, page: name, ...f })
      if (SHOTS_DIR !== '') {
        const sheet = await page.$('dialog[open]')
        for (const theme of SHOT_THEMES) {
          await page.emulateMedia({ colorScheme: theme })
          await page.waitForTimeout(80)
          await page.screenshot({
            path: join(SHOTS_DIR, `${SHOT_PREFIX}-${deviceSlug}-${name}-${theme}.png`),
            fullPage: sheet === null,
          })
        }
        await page.emulateMedia({ colorScheme: 'light' })
      }
      console.log(`  ${deviceName} · ${name}: ${found.length === 0 ? 'ok' : found.length + ' hallazgos'}`)
      // Lo plegado ("Más detalle", las rondas viejas) también se mira, abierto.
      const folded = await page.$$('details:not([open])')
      if (folded.length > 0 && (await page.$('dialog[open]')) === null && !name.endsWith('-detalle')) {
        await page.$$eval('details:not([open])', (all) =>
          all.forEach((d) => {
            d.dataset.auditoria = ''
            d.open = true
          }),
        )
        await h.check(`${name}-detalle`)
        await page.$$eval('details[data-auditoria]', (all) =>
          all.forEach((d) => {
            delete d.dataset.auditoria
            d.open = false
          }),
        )
      }
    },
    /** Toca el botón (fuera de una hoja abierta) que abre una hoja, la mira y la cierra. */
    async sheet(buttonName, name, then) {
      const button = page.getByRole('button', { name: buttonName, exact: typeof buttonName === 'string' }).first()
      await button.click()
      await page.waitForSelector('dialog[open]')
      if (then) await then()
      await h.check(name)
      await h.closeSheet()
    },
    async closeSheet() {
      if ((await page.$('dialog[open]')) === null) return
      await page.keyboard.press('Escape')
      await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 3000 }).catch(() => {})
      await page.waitForFunction(() => document.querySelector('dialog[open]') === null, null, { timeout: 3000 }).catch(() => {})
    },
    button: (name, exact = true) => page.getByRole('button', { name, exact }).first(),
  }

  async function scene(name, run) {
    if (ONLY !== '' && !ONLY.split(',').some((part) => name.includes(part))) return
    try {
      await withTimeout(run(), 10 * 60000, `la escena ${name}`)
    } catch (error) {
      failed = true
      findings.push({ device: deviceName, page: current || name, kind: 'error', what: name, detail: String(error).split('\n')[0] })
      console.log(`  ${deviceName} · ${name}: ERROR ${String(error).split('\n')[0]}`)
      await h.closeSheet().catch(() => {})
    }
  }

  console.log(`\n== ${deviceName} (${BROWSER})`)

  // ── Sin sesión ──────────────────────────────────────────────────────────
  for (const [name, path] of [
    ['landing', '/'],
    ['login', '/login'],
    ['registro', '/registro'],
    ['recuperar', '/login/recuperar'],
    ['unirse-invalido', '/unirse/token-que-no-existe'],
    ['privacidad-fuera', '/privacidad'],
    ['404', '/no-existe-esta-pagina'],
    ['offline', '/offline.html'],
  ]) {
    await scene(name, async () => {
      await h.go(path)
      await h.check(name)
    })
  }

  // ── Con sesión ──────────────────────────────────────────────────────────
  // Iniciar sesión, con reintento: contra `next dev` el primer envío puede llegar
  // antes de que la página termine de hidratar y no hacer nada.
  for (let attempt = 1; ; attempt++) {
    await h.go('/login')
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PASSWORD)
    await page.keyboard.press('Enter')
    try {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
      break
    } catch (error) {
      if (attempt === 3) throw error
    }
  }
  // Después de entrar, Inicio se vuelve a pedir una vez más (refresco de la sesión).
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  // Los torneos y amigos de Inicio: de acá salen las rutas de las escenas.
  const home = { tournaments: [], friends: [] }
  await h.go('/torneos')
  const links = await page.$$eval('a[href^="/torneo/"]', (as) =>
    as.map((a) => ({ href: a.getAttribute('href'), label: a.getAttribute('aria-label') ?? a.textContent ?? '' })),
  )
  home.tournaments = links.filter((l) => /^\/torneo\/[^/]+$/.test(l.href))
  home.friends = await page.$$eval('a[href^="/amigos/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href').split('?')[0]))])

  await scene('inicio', async () => {
    await h.go('/torneos')
    await h.check('inicio')
    const more = page.getByRole('button', { name: /^Ver los \d+ torneos$/ })
    if ((await more.count()) > 0) {
      await more.first().click()
      await h.check('inicio-torneos-abiertos')
    }
    await h.sheet('Cargar partido', 'inicio-hoja-cargar')
    // El menú de cuenta es un desplegable, no una hoja.
    await h.button(/^Tu cuenta/, false).click()
    await h.check('inicio-menu-cuenta')
    await h.button(/^Tu cuenta/, false).click()
  })

  await scene('nuevo', async () => {
    await h.go('/torneos/nuevo')
    await h.check('nuevo-1-deporte')
    await page.fill('input[placeholder="Los Jueves 2026"]', 'Auditoría móvil con un nombre bien largo')
    await page.locator('button[aria-pressed][data-deporte="PADEL"]').click()
    await page.locator('button[aria-pressed][data-deporte="FIFA"]').click()
    await h.check('nuevo-1-elegido')
    await h.button('Continuar').click()
    const names = ['Martín', 'Tomás Fernández Larrañaga', 'Nico', 'Lucas', 'Juampi', 'Gonza', 'Facu', 'Seba']
    for (let i = 0; i < names.length; i++) {
      const field = page.locator(`input[aria-label="Jugador ${i + 1}"]`)
      if ((await field.count()) === 0) break
      if ((await field.inputValue()) === '') await field.fill(names[i])
    }
    await h.check('nuevo-2-jugadores')
    await h.button('Continuar').click()
    await h.check('nuevo-3-como')
    const personalizar = page.getByRole('button', { name: /^Personalizar reglas/ })
    if ((await personalizar.count()) > 0) {
      await personalizar.first().click()
      await page.waitForSelector('dialog[open]')
      await h.check('nuevo-3-hoja-reglas')
      await h.closeSheet()
    }
    for (let step = 0; step < 4 && (await h.button('Continuar').count()) > 0; step++) {
      await h.button('Continuar').click()
      await page.waitForTimeout(300)
      await h.check(`nuevo-4-paso-${step + 1}`)
    }
  })

  for (const wanted of TOURNAMENTS) {
    const [name, hint] = wanted.split('|')
    const match = home.tournaments.find((t) => t.label.startsWith(name + ',') && (hint === undefined || t.label.includes(hint)))
    const tslug = slug(name)
    await scene(`t-${tslug}`, async () => {
      if (!match) throw new Error(`no encontré el torneo "${wanted}" en Inicio`)
      const root = match.href
      await h.go(root)
      await h.check(`t-${tslug}-tabla`)
      const path = new URL(page.url()).pathname
      const sports = await page.$$eval('nav a, a', (as) =>
        [...new Set(as.map((a) => a.getAttribute('href') ?? '').filter((href) => /^\/torneo\/[^/]+\/[a-z-0-9]+$/.test(href)))],
      )
      const disciplineRoots = sports.filter((href) => href.startsWith(root + '/') && !/\/(ajustes|reglas|stats|fechas)$/.test(href))
      const disciplineRoot = /^\/torneo\/[^/]+\/[^/]+$/.test(path) && !/\/(ajustes|reglas|stats|fechas)$/.test(path) ? path : disciplineRoots[0]
      if (disciplineRoot && disciplineRoot !== path) {
        await h.go(disciplineRoot)
        await h.check(`t-${tslug}-tabla-deporte`)
      }
      const base = disciplineRoot ?? path
      await h.go(base + '/fechas')
      await page.waitForSelector('a[href*="/fechas/"]', { timeout: 5000 }).catch(() => {})
      await h.check(`t-${tslug}-fechas`)
      const fechas = await page.$$eval('a[href*="/fechas/"]', (as) => {
        const byNumber = new Map()
        for (const href of as.map((a) => a.getAttribute('href'))) {
          const n = href.match(/\/fechas\/(\d+)$/)?.[1]
          if (n !== undefined && !byNumber.has(n)) byNumber.set(n, href)
        }
        return [...byNumber.values()]
      })
      for (const fecha of fechas.slice(0, 3)) {
        const n = fecha.split('/').pop()
        const id = `t-${tslug}-fecha-${n}`
        await h.go(fecha)
        await h.check(id)
        // La hoja de carga: la de un partido sin cargar, o la de corregir uno cargado.
        const opener = page.locator('button[aria-label^="Cargar "], button[aria-label^="Corregir "]')
        if ((await opener.count()) > 0) {
          await opener.first().click()
          if (await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => null)) {
            await h.check(`${id}-hoja`)
            await h.closeSheet()
          }
        }
      }
      await h.go(base + '/stats')
      await h.check(`t-${tslug}-stats`)
      await h.go(base + '/stats?tab=mias')
      await h.check(`t-${tslug}-stats-mias`)
      await h.go(base)
      const jugador = await page.$('a[href*="/jugador/"]')
      if (jugador) {
        await h.go(await jugador.getAttribute('href'))
        await h.check(`t-${tslug}-jugador`)
      }
      await h.go(base + '/ajustes')
      await h.check(`t-${tslug}-ajustes-deporte`)
      for (const button of ['Personalizar reglas', 'Editar']) {
        if ((await h.button(button).count()) > 0) await h.sheet(button, `t-${tslug}-ajustes-deporte-${slug(button)}`)
      }
      await h.go(root + '/reglas')
      await h.check(`t-${tslug}-reglas`)
    })
  }

  // Ajustes del torneo con todas sus hojas, y la invitación de verdad.
  let invite = null
  await scene('ajustes', async () => {
    const match = home.tournaments.find((t) => t.label.startsWith('Los Pibes del Martes,') && t.label.includes('Fecha 2'))
    if (!match) throw new Error('no encontré "Los Pibes del Martes" en Inicio')
    await h.go(match.href + '/ajustes')
    await h.check('ajustes')
    await h.sheet(/^Nombre/, 'ajustes-hoja-nombre')
    const firstSeat = page.locator('button', { hasText: 'vos' }).first()
    if ((await firstSeat.count()) > 0) {
      await firstSeat.click()
      await page.waitForSelector('dialog[open]')
      await h.check('ajustes-hoja-asiento')
      await h.closeSheet()
    }
    await h.sheet('+ Agregar jugador', 'ajustes-hoja-agregar-jugador')
    await h.sheet('Personalizar reglas', 'ajustes-hoja-reglas')
    await h.sheet('Editar', 'ajustes-hoja-editar')
    await h.sheet('+ Agregar un deporte', 'ajustes-hoja-deporte')
    if ((await h.button('Pasar').count()) > 0) await h.sheet('Pasar', 'ajustes-hoja-pasar')
    await h.sheet('Eliminar torneo', 'ajustes-hoja-eliminar')
    await h.button('Copiar link').click()
    invite = await page.evaluate(() => window.__copiado ?? null)
  })
  await scene('unirse-real', async () => {
    if (invite === null) throw new Error('no se pudo leer el link de invitación')
    await page.goto(invite.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' })
    await h.check('unirse-real')
  })

  await scene('amigos', async () => {
    await h.go('/amigos')
    await h.check('amigos')
    const friend = home.friends[0]
    if (!friend) throw new Error('no hay amigos en Inicio')
    await h.go(friend)
    await h.check('amigo')
    await h.sheet(/^Cargar partido con/, 'amigo-hoja-padel')
    for (const sport of ['Ping pong', 'FIFA', 'Ajedrez', 'Bowling', 'Tenis']) {
      await h.sheet(/^Cargar partido con/, `amigo-hoja-${slug(sport)}`, async () => {
        const option = page.locator('dialog[open]').getByRole('button', { name: sport, exact: true })
        const radio = page.locator('dialog[open] label', { hasText: new RegExp(`^${sport}$`) })
        if ((await option.count()) > 0) await option.first().click()
        else if ((await radio.count()) > 0) await radio.first().click()
        else throw new Error(`la hoja no ofrece ${sport}`)
        await page.waitForTimeout(250)
      })
    }
    const corregir = page.getByRole('button', { name: /^Corregir: / })
    if ((await corregir.count()) > 0) {
      await corregir.first().click()
      await page.waitForSelector('dialog[open]')
      await h.check('amigo-hoja-corregir')
      await h.closeSheet()
    }
  })

  await scene('rapido', async () => {
    await h.go('/rapido')
    await page.evaluate(() => localStorage.clear())
    await h.go('/rapido')
    await h.check('rapido-armar')
    const names = ['Ana', 'Beto Rodríguez Etcheverry', 'Caro', 'Dani']
    for (let i = 0; i < names.length; i++) {
      const field = page.locator('input').nth(i)
      if ((await field.count()) > 0) await field.fill(names[i])
    }
    await h.check('rapido-armar-nombres')
    await h.button('Empezar').click()
    await page.waitForTimeout(500)
    await h.check('rapido-jugando')
    const cargar = page.locator('button[aria-label^="Cargar "]')
    if ((await cargar.count()) > 0) {
      await cargar.first().click()
      await page.waitForSelector('dialog[open]')
      await h.check('rapido-hoja')
      await h.closeSheet()
    }
    // Hasta el campeón: cada partido con el primer resultado que ofrece la hoja
    // (quién ganó y después los games), que guarda sola en el último toque.
    for (let i = 0; i < 12 && (await cargar.count()) > 0; i++) {
      await cargar.first().click()
      await page.waitForSelector('dialog[open]')
      const winner = page.locator('dialog[open] button:not([disabled])').filter({ hasNotText: /^(Cancelar|Cerrar)$/ })
      if ((await winner.count()) > 0) await winner.first().click()
      await page.waitForTimeout(300)
      for (let k = 0; k < 3 && (await page.$('dialog[open]')) !== null; k++) {
        const games = page.locator('dialog[open] button:not([disabled])').filter({ hasText: /^\d/ })
        if ((await games.count()) === 0) break
        await games.first().click()
        await page.waitForTimeout(300)
      }
      await h.closeSheet()
    }
    const campeon = page.getByRole('button', { name: 'Ver campeón', exact: true })
    if ((await campeon.count()) > 0) await campeon.click()
    await page.waitForTimeout(400)
    await h.check('rapido-final')
    // Bowling.
    await page.evaluate(() => localStorage.clear())
    await h.go('/rapido')
    await page.getByRole('button', { name: /^Bowling/ }).click()
    for (let i = 0; i < 3; i++) {
      const field = page.locator('input').nth(i)
      if ((await field.count()) > 0) await field.fill(names[i])
    }
    await h.button('Empezar').click()
    await page.waitForTimeout(500)
    await h.check('rapido-bowling')
    await page.evaluate(() => localStorage.clear())
  })

  for (const [name, path] of [
    ['privacidad', '/privacidad'],
    ['cuenta-borrar', '/cuenta/borrar'],
    ['404-sesion', '/torneo/00000000-0000-0000-0000-000000000000'],
  ]) {
    await scene(name, async () => {
      await h.go(path)
      await h.check(name)
    })
  }

  await scene('reglas-fuera', async () => {
    const match = home.tournaments[0]
    await context.clearCookies()
    await h.go(match.href + '/reglas')
    await h.check('reglas-fuera')
  })

  // El recargado en caliente de `next dev` no es un error de la app.
  // Tampoco los prefetch (`?_rsc=`) que el navegador corta al cambiar de página.
  const devNoise = /_next\/static\/webpack|__nextjs_original-stack-frames|webpack-hmr|_rsc=/
  for (const error of errors.filter((e) => !devNoise.test(e))) findings.push({ device: deviceName, page: '-', kind: 'js-error', what: error.slice(0, 80), detail: '' })
  all.push(...findings)
  await browser.close()
}

console.log('\n| dispositivo | página | tipo | elemento | detalle |\n|---|---|---|---|---|')
for (const f of all) console.log(`| ${f.device} | ${f.page} | ${f.kind} | ${f.what.replace(/\|/g, '/')} | ${f.detail} |`)
const byDevice = Object.fromEntries(DEVICES.map((d) => [d, all.filter((f) => f.device === d).length]))
console.log('\nHallazgos por dispositivo:', JSON.stringify(byDevice))
if (SHOTS_DIR !== '') {
  mkdirSync(SHOTS_DIR, { recursive: true })
  writeFileSync(join(SHOTS_DIR, `${SHOT_PREFIX}-${BROWSER}-findings.json`), JSON.stringify(all, null, 2))
}
process.exit(all.length > 0 || failed ? 1 : 0)
