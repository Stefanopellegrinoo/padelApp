// Read-only gallery of the mockups under design/, for viewing them from other
// devices on the tailnet. The gentle-design canvas only listens on loopback and
// changes port on every start; this serves the same files at a fixed address.
//
//   node scripts/design-gallery.mjs            # http://100.81.177.86:8091/
//   GALLERY_HOST=127.0.0.1 GALLERY_PORT=8092 node scripts/design-gallery.mjs

import { createServer } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = process.env.GALLERY_HOST ?? '100.81.177.86'
const PORT = Number(process.env.GALLERY_PORT ?? 8091)
const ROOT = fileURLToPath(new URL('../design/', import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const PAGE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Archivo, ui-sans-serif, system-ui, sans-serif; background: #eef1ee; color: #10231a; padding: 20px; }
  a { color: #0e5c3f; font-weight: 800; }
  a:focus-visible { outline: 3px solid #0e5c3f; outline-offset: 2px; }
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -.03em; }
  .lead { color: #5f6e66; font-size: 14px; font-weight: 550; margin: 6px 0 20px; max-width: 70ch; line-height: 1.45; }
  .designs { display: grid; gap: 12px; max-width: 640px; }
  .design { display: block; background: #fff; border: 1px solid #e4e9e5; border-radius: 16px; padding: 16px; text-decoration: none; color: inherit; }
  .design b { font-size: 17px; }
  .design span { display: block; color: #5f6e66; font-size: 13px; font-weight: 600; margin-top: 4px; }
  .boards { display: flex; gap: 28px; overflow-x: auto; align-items: flex-start; padding-bottom: 16px; }
  .board { flex-shrink: 0; }
  .board h2 { font-size: 15px; font-weight: 800; }
  .board p { color: #5f6e66; font-size: 12.5px; font-weight: 600; margin: 3px 0 8px; line-height: 1.4; }
  .board iframe { border: 1px solid #e4e9e5; border-radius: 20px; background: #fff; display: block; }
  .back { display: inline-block; margin-bottom: 12px; }
`

function page(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`
}

async function manifests() {
  const entries = await readdir(ROOT, { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(await readFile(join(ROOT, entry.name, 'design.json'), 'utf8'))
      found.push({ slug: entry.name, ...manifest })
    } catch {
      // A folder without a readable manifest is not a design.
    }
  }
  return found.sort((a, b) => a.slug.localeCompare(b.slug))
}

async function indexPage() {
  const designs = await manifests()
  const items = designs
    .map((d) => `<a class="design" href="/${encodeURIComponent(d.slug)}/"><b>${escape(d.title ?? d.slug)}</b><span>${escape(d.brief ?? '')}</span></a>`)
    .join('')
  const system = '<a class="design" href="/system.html"><b>Sistema actual</b><span>Colores, tipografía y componentes de hoy.</span></a>'
  return page('Maquetas', `<h1>Maquetas</h1><p class="lead">Rediseño de la app. Tocá un diseño para ver sus opciones una al lado de la otra.</p><div class="designs">${items}${system}</div>`)
}

async function designPage(slug) {
  const design = (await manifests()).find((d) => d.slug === slug)
  if (!design) return null
  const boards = (design.artboards ?? [])
    .map((a) => {
      const src = `/${encodeURIComponent(slug)}/${encodeURIComponent(a.file)}`
      return `<section class="board" style="width:${Number(a.width)}px"><h2>${escape(a.title)}</h2><p>${escape(a.tradeoff ?? '')} · <a href="${src}">Abrir sola</a></p><iframe title="${escape(a.title)}" src="${src}" width="${Number(a.width)}" height="${Number(a.height)}" loading="lazy"></iframe></section>`
    })
    .join('')
  return page(design.title ?? slug, `<a class="back" href="/">‹ Maquetas</a><h1>${escape(design.title ?? slug)}</h1><p class="lead">${escape(design.brief ?? '')}</p><div class="boards">${boards}</div>`)
}

async function sendFile(res, path) {
  // Resolve inside design/ only; anything that escapes it is not found.
  const full = normalize(join(ROOT, path))
  if (!full.startsWith(ROOT) || full.split(sep).some((part) => part.startsWith('.') && part.length > 1)) return false
  try {
    if (!(await stat(full)).isFile()) return false
    const body = await readFile(full)
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(body)
    return true
  } catch {
    return false
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  let path
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://gallery').pathname)
  } catch {
    res.writeHead(400).end()
    return
  }
  const html = (body) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(body)
  }
  if (path === '/') return html(await indexPage())
  const slug = path.match(/^\/([a-z0-9-]+)\/$/)?.[1]
  if (slug) {
    const body = await designPage(slug)
    if (body) return html(body)
  }
  if (await sendFile(res, path)) return
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe.')
})

server.listen(PORT, HOST, () => {
  console.log(`Maquetas en http://${HOST}:${PORT}/`)
})
