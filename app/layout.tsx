import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Historial } from './torneo/[id]/volver'
import { PullToRefresh } from './pull-to-refresh'
import { ServiceWorker } from './service-worker'

/**
 * Archivo variable con los dos ejes: el peso (100-900) viene con la variable y
 * el ancho (`wdth`, 62-125) se pide aparte. De una sola familia salen el texto
 * (100%), los títulos (75%, `font-titulo`) y los números de marcador (62%,
 * `font-cond`). `variable` la deja en `--font-archivo`, que es lo que lee
 * `--font-sans` en `globals.css`.
 *
 * Local y no `next/font/google`: el archivo que sirve Google para estos dos
 * ejes deja huecos entre letras ("f echa", "p ts"), medido lado a lado contra
 * este, que es el de fontsource que usó el prototipo (`design/prototipo/`).
 * Licencia OFL en `fonts/OFL.txt`.
 */
const archivo = localFont({
  src: './fonts/archivo-wdth.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
  variable: '--font-archivo',
})

// Las pantallas de arranque de iOS que genera `scripts/icons.py` (misma lista
// que `IPHONES` allá): sin ellas, la app instalada queda en negro hasta que
// llega el HTML. iOS elige por media query, así que cada tamaño va por tema.
const IPHONES: [number, number, number][] = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2],
  [414, 896, 3], [390, 844, 3], [428, 926, 3], [393, 852, 3], [430, 932, 3],
  [402, 874, 3], [440, 956, 3], [420, 912, 3],
]
const startupImage = IPHONES.flatMap(([w, h, dpr]) =>
  (['light', 'dark'] as const).map((tema) => ({
    url: `/splash/${w}x${h}@${dpr}-${tema}.png`,
    media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${tema})`,
  })),
)

export const metadata: Metadata = {
  title: 'Padel Liga',
  description: 'El campeonato del grupo: la tabla, las fechas y los resultados.',
  openGraph: {
    title: 'Padel Liga',
    description: 'El campeonato del grupo: la tabla, las fechas y los resultados.',
    locale: 'es_AR',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
  // `appleWebApp` es lo que iOS mira, porque hasta hace poco ignoraba el
  // manifest para esto. `statusBarStyle: 'default'` deja que iOS se ocupe de la
  // barra de estado en vez de meter el contenido abajo: `black-translucent`
  // daría el look a pantalla completa pero exige pagar `env(safe-area-inset-top)`
  // a mano en cada pantalla, y una sola que se olvide queda con el título
  // debajo de la isla dinámica.
  appleWebApp: { capable: true, title: 'Padel', statusBarStyle: 'default', startupImage },
}

/**
 * `viewportFit: 'cover'` es lo que hace que `env(safe-area-inset-bottom)` tenga
 * un valor: sin él iOS mete la página adentro del área segura y el inset vale
 * 0, así que el fondo corta antes del borde y la nav queda flotando sobre una
 * franja. Con `cover` la página llega al borde y la nav se paga su propio
 * espacio para el indicador de inicio.
 *
 * NO se toca `maximumScale` ni `userScalable`. Sería la tentación obvia contra
 * el zoom al enfocar un campo, pero iOS los ignora para el pinch desde hace
 * años —así que no arreglaría nada— y bloquear el zoom del usuario rompe la
 * accesibilidad. El zoom al enfocar tiene una sola causa de verdad y es que el
 * input mida menos de 16px; por eso todos los de la app miden 16.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Dos, uno por paleta: la app ya sigue al sistema con
  // `prefers-color-scheme` en `globals.css`, y un `theme_color` solo dejaría la
  // barra del navegador oscura sobre una app clara. El manifest lleva el
  // oscuro nada más porque ahí sólo entra uno. En claro es el azul cancha del
  // bloque de arriba, así la barra continúa el encabezado; en oscuro, el fondo
  // azul noche.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1F45E0' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1630' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={archivo.variable}>
      <body className={archivo.className}>
        {children}
        <ServiceWorker />
        <Historial />
        <PullToRefresh />
      </body>
    </html>
  )
}
