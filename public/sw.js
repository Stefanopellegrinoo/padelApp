// El único service worker de la app, y a propósito no guarda NINGUNA página:
// las pantallas privadas se arman en el servidor detrás de la sesión y no
// pueden quedar en el teléfono. Lo único guardado es `offline.html`, que se
// muestra cuando una navegación falla por falta de red — en vez del error
// genérico de Safari, que es lo que más delata "esto es una web".
const CACHE = 'offline-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/offline.html')))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      // Sin navigation preload: la v1 lo prendía y en el iPhone "Reintentar"
      // no volvía a cargar la app. Se apaga explícito porque queda prendido en
      // el registro aunque el worker nuevo no lo use.
      await self.registration.navigationPreload?.disable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request)
      } catch {
        return (await caches.match('/offline.html')) ?? Response.error()
      }
    })(),
  )
})
