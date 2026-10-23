import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

/**
 * La tarjeta que aparece al pegar un link de la app en WhatsApp. Es la misma
 * para todas las pantallas: la invitación (`/unirse/…`) sin sesión redirige al
 * registro antes de leer el torneo, así que su nombre no está disponible para
 * quien arma la vista previa. Se genera una vez, en el build.
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
          gap: 56,
          padding: '0 96px',
          background: '#0d1512',
          color: '#eaf2ee',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${icono.toString('base64')}`}
          width={260}
          height={260}
          style={{ borderRadius: 64 }}
          alt=""
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: '-0.03em' }}>Padel Liga</div>
          <div style={{ fontSize: 36, color: '#8ea298', maxWidth: 680 }}>
            El campeonato del grupo: la tabla, las fechas y los resultados.
          </div>
        </div>
      </div>
    ),
    size,
  )
}
