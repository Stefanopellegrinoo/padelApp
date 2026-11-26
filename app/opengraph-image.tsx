import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

/**
 * La tarjeta que aparece al pegar un link de la app en WhatsApp. Es la misma
 * para todas las pantallas: la invitación (`/unirse/…`) sin sesión redirige al
 * registro antes de leer el torneo, así que su nombre no está disponible para
 * quien arma la vista previa. Se genera una vez, en el build.
 *
 * Es el bloque azul cancha del prototipo, entero: la pala del ícono tiene ese
 * mismo fondo, así que se ve dibujada sobre el bloque y no como un cuadrado
 * pegado. Blanco y el blanco suave de los encabezados (`on-block`,
 * `on-block-soft` de `globals.css`), AA sobre el azul.
 */
export const alt = 'Padel Liga'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const icono = await readFile(join(process.cwd(), 'public/icon-512.png'))
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 40,
          padding: '0 96px 0 64px',
          background: '#1f45e0',
          color: '#ffffff',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${icono.toString('base64')}`}
          width={300}
          height={300}
          alt=""
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>Padel Liga</div>
          <div style={{ fontSize: 38, color: '#c9d3ff', maxWidth: 640, lineHeight: 1.3 }}>
            El campeonato del grupo: la tabla, las fechas y los resultados.
          </div>
        </div>
      </div>
    ),
    size,
  )
}
