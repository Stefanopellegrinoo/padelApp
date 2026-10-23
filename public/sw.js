// El único service worker de la app, y a propósito no guarda NINGUNA página:
// las pantallas privadas se arman en el servidor detrás de la sesión y no
// pueden quedar en el teléfono. Lo único guardado es `offline.html`, que se
// muestra cuando una navegación falla por falta de red — en vez del error
// genérico de Safari, que es lo que más delata "esto es una web".
const CACHE = 'offline-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/offline.html')))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      // Arranca el pedido en paralelo con el arranque del worker: sin esto,
      // cada navegación espera a que el worker despierte antes de salir.
      await self.registration.navigationPreload?.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) ?? (await fetch(event.request))
      } catch {
        return (await caches.match('/offline.html')) ?? Response.error()
      }
    })(),
  )
})
