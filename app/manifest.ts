import type { MetadataRoute } from 'next'

/**
 * El manifest, que es lo que convierte "una web" en "una app de la pantalla de
 * inicio".
 *
 * `start_url` es `/torneos` y no `/`: la landing es la pantalla de venta para
 * quien todavía no tiene cuenta, y quien se instaló la app YA la tiene. Sin
 * sesión el middleware la manda al login, que es exactamente lo que hay que
 * hacer. Es la misma regla que `afterLogin`.
 *
 * `display: 'standalone'` saca la barra de Safari. Eso también saca el botón
 * "atrás" del navegador, así que la app tiene que poder recorrerse sola —
 * verificado: no hay un solo `router.back()` en el código, la nav de abajo une
 * las cuatro pestañas y la flecha sube desde Tabla y desde Ajustes.
 *
 * Los íconos van declarados `any maskable` con un solo archivo: la pala ocupa
 * el 58% del lienzo, bien adentro del 80% central que Android recorta, así que
 * el mismo PNG sirve recortado y sin recortar. Se generan con
 * `python3 scripts/icons.py`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Padel Liga',
    // El nombre que entra debajo del ícono sin cortarse.
    short_name: 'Padel',
    description: 'El campeonato del grupo: la tabla, las fechas y los resultados.',
    lang: 'es-AR',
    start_url: '/torneos',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // El fondo oscuro de la app. Es el color de la pantalla de arranque, así
    // que un blanco acá sería un flash blanco cada vez que se abre.
    background_color: '#0d1512',
    theme_color: '#0d1512',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
