import type { Metadata, Viewport } from 'next'
import { Archivo } from 'next/font/google'
import './globals.css'

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = {
  title: 'Padel Liga',
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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={archivo.className}>{children}</body>
    </html>
  )
}
