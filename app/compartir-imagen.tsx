'use client'

import { useEffect, useState } from 'react'

export interface FilaImagen {
  nombre: string
  /** Sin puntos, la fila es sólo el texto (los partidos de una fecha). */
  puntos?: number | string
  /** Encabezado de sección ("Ronda 1"): sin fondo y en gris. */
  titulo?: boolean
}

interface CompartirImagenProps {
  /** Nombre del archivo, sin extensión. */
  archivo: string
  titulo: string
  subtitulo: string
  filas: readonly FilaImagen[]
}

const ANCHO = 1080
const MARGEN = 64
const ALTO_FILA = 72
const CABECERA = 210
const PIE = 110
// La paleta clara del prototipo (`globals.css`), fija: la imagen se ve igual en
// cualquier chat y con cualquier tema. Arriba el bloque azul cancha, como el
// encabezado de la app; abajo filas en tinta separadas por una línea. Sin
// amarillo: la imagen la ve todo el grupo y no hay un "vos".
const FONDO = '#ffffff'
const BLOQUE = '#1f45e0'
const EN_BLOQUE = '#ffffff'
const EN_BLOQUE_SUAVE = '#c9d3ff'
const TINTA = '#0e1a4a'
const TENUE = '#4b5675'
const LINEA = '#dce1ee'
// El radio de 24 px de los bloques, a la escala de la imagen (1080 de ancho
// contra los ~390 del teléfono).
const RADIO = 56

/**
 * "Compartir": una imagen de la tabla para mandar al grupo de WhatsApp, que la
 * ve quien no tiene cuenta. Se dibuja en un canvas en el celular, sin servidor
 * ni librerías. Se arma al montar y no al tocar: Safari sólo abre el menú de
 * compartir si `navigator.share` corre en el toque mismo, sin un `await` antes.
 */
export function CompartirImagen({ archivo, titulo, subtitulo, filas }: CompartirImagenProps) {
  const [file, setFile] = useState<File | null>(null)
  const clave = JSON.stringify([archivo, titulo, subtitulo, filas])

  useEffect(() => {
    let vigente = true
    dibujar(titulo, subtitulo, filas)
      .then((blob) => vigente && setFile(new File([blob], `${archivo}.png`, { type: 'image/png' })))
      .catch(() => {})
    return () => {
      vigente = false
    }
    // `clave` resume las props: la tabla llega como array nuevo en cada render.
  }, [clave])

  if (file === null) return null

  function compartir(file: File) {
    if (navigator.canShare?.({ files: [file] })) {
      // Cancelar el menú también rechaza: no es un error.
      navigator.share({ files: [file], title: titulo }).catch(() => {})
      return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = file.name
    link.click()
  }

  return (
    <button
      type="button"
      onClick={() => compartir(file)}
      aria-label="Compartir"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chip"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15V3M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      </svg>
    </button>
  )
}

async function dibujar(titulo: string, subtitulo: string, filas: readonly FilaImagen[]): Promise<Blob> {
  // Sin esperar la fuente, el canvas usa la del sistema la primera vez.
  await document.fonts?.ready
  const fuente = getComputedStyle(document.body).fontFamily
  const canvas = document.createElement('canvas')
  canvas.width = ANCHO
  canvas.height = CABECERA + filas.length * ALTO_FILA + PIE
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('Sin canvas')

  ctx.fillStyle = FONDO
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.textBaseline = 'middle'

  // El bloque del encabezado, con las esquinas de abajo redondeadas.
  const altoBloque = CABECERA - 24
  ctx.fillStyle = BLOQUE
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(ANCHO, 0)
  ctx.lineTo(ANCHO, altoBloque - RADIO)
  ctx.arcTo(ANCHO, altoBloque, ANCHO - RADIO, altoBloque, RADIO)
  ctx.lineTo(RADIO, altoBloque)
  ctx.arcTo(0, altoBloque, 0, altoBloque - RADIO, RADIO)
  ctx.closePath()
  ctx.fill()

  // Títulos y números en la cara condensada de Archivo, donde el canvas la sabe
  // pedir (`fontStretch`); si no, sale ancha y no pasa nada. Va DESPUÉS de
  // `ctx.font`, que la vuelve a `normal` cada vez que se asigna.
  const condensada = () => {
    if ('fontStretch' in ctx) ctx.fontStretch = 'condensed'
  }

  ctx.fillStyle = EN_BLOQUE
  ctx.font = `800 64px ${fuente}`
  condensada()
  ctx.fillText(recortar(ctx, titulo, ANCHO - 2 * MARGEN), MARGEN, 84)
  ctx.fillStyle = EN_BLOQUE_SUAVE
  ctx.font = `600 30px ${fuente}`
  ctx.fillText(recortar(ctx, subtitulo, ANCHO - 2 * MARGEN), MARGEN, 144)

  let primera = true
  const lider = filas.findIndex((fila) => fila.puntos !== undefined)
  filas.forEach((fila, index) => {
    const y = CABECERA + index * ALTO_FILA
    const centro = y + ALTO_FILA / 2
    ctx.textAlign = 'left'
    if (fila.titulo) {
      primera = true
      ctx.fillStyle = TENUE
      ctx.font = `700 28px ${fuente}`
      ctx.fillText(recortar(ctx, fila.nombre, ANCHO - 2 * MARGEN), MARGEN, centro + 8)
      return
    }
    // El divisor va arriba de cada fila salvo la primera de su grupo, como en
    // las listas de la app.
    if (!primera) {
      ctx.fillStyle = LINEA
      ctx.fillRect(MARGEN, y, ANCHO - 2 * MARGEN, 2)
    }
    primera = false
    let anchoDer = -32
    if (fila.puntos !== undefined) {
      const der = `${fila.puntos} ${Number(fila.puntos) === 1 ? 'pt' : 'pts'}`
      ctx.font = `800 40px ${fuente}`
      condensada()
      ctx.fillStyle = index === lider ? BLOQUE : TINTA
      ctx.textAlign = 'right'
      ctx.fillText(der, ANCHO - MARGEN, centro)
      anchoDer = ctx.measureText(der).width
      ctx.textAlign = 'left'
    }
    const anchoNombre = ANCHO - 2 * MARGEN - anchoDer - 32
    // Un partido de parejas es largo: achicar antes de que el "…" se coma al rival.
    let tamaño = 34
    do ctx.font = `700 ${tamaño--}px ${fuente}`
    while (fila.puntos === undefined && tamaño >= 24 && ctx.measureText(fila.nombre).width > anchoNombre)
    ctx.fillStyle = TINTA
    ctx.fillText(recortar(ctx, fila.nombre, anchoNombre), MARGEN, centro)
  })

  ctx.fillStyle = TENUE
  ctx.font = `700 28px ${fuente}`
  ctx.fillText('Padel Liga', MARGEN, canvas.height - PIE / 2)

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob === null ? reject(new Error('Sin imagen')) : resolve(blob)), 'image/png'),
  )
}

/** Corta con "…" lo que no entra en `ancho`, con la fuente que el contexto tenga puesta. */
function recortar(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
  if (ctx.measureText(texto).width <= ancho) return texto
  let corto = texto
  while (corto.length > 1 && ctx.measureText(`${corto}…`).width > ancho) corto = corto.slice(0, -1)
  return `${corto}…`
}
