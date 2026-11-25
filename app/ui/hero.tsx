import type { ReactNode } from 'react'
import { Volver } from '@/app/torneo/[id]/volver'

/**
 * El encabezado en bloque del prototipo: el bloque de color de arriba, con las
 * esquinas de abajo redondeadas, que dice dónde estás. De arriba abajo:
 * `Volver` con su destino, el `kicker` (de qué es: "Pádel", el torneo), el
 * título grande y el `subtitle` en el blanco suave. `right` va a la altura
 * del título, a la derecha (tu puesto, "3°"); `children`, debajo de todo
 * (confirmaciones, la píldora "Ver la fecha").
 *
 * `titleVariant`: `'title'` (34 px, ancho 75 %) para un nombre, `'number'`
 * (72 px, ancho 62 %) para un número que se lee de lejos, "Fecha 8".
 *
 * `sport` es el `kind` de `core/sports.ts`: pinta el bloque del deporte
 * (`data-deporte`, ver `globals.css`). Sin él, azul cancha.
 *
 * Adentro del bloque el anillo de foco es blanco (`--color-focus` pisado):
 * el de tinta no se ve sobre azul. Es de servidor; `Volver` es el único
 * pedazo de cliente.
 */
export function Hero({
  back,
  kicker,
  title,
  subtitle,
  right,
  children,
  titleVariant = 'title',
  sport,
}: {
  back?: { href: string; label?: string; desanda?: boolean }
  kicker?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  children?: ReactNode
  titleVariant?: 'title' | 'number'
  sport?: string
}) {
  const titleClass =
    titleVariant === 'number'
      ? 'font-cond text-[72px]'
      : 'font-titulo text-[34px] text-balance'
  return (
    <header
      data-deporte={sport}
      className="rounded-b-block bg-block px-4 pt-[calc(6px+env(safe-area-inset-top))] pb-5 text-on-block [--color-focus:var(--color-on-block)]"
    >
      {back !== undefined && <Volver href={back.href} label={back.label} desanda={back.desanda} />}
      {kicker !== undefined && (
        <div className="mt-2 flex items-center gap-2 text-[15px] font-semibold text-on-block-soft">{kicker}</div>
      )}
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className={titleClass}>{title}</h1>
          {subtitle !== undefined && <p className="mt-1.5 text-[15px] text-on-block-soft">{subtitle}</p>}
        </div>
        {right !== undefined && <div className="shrink-0 text-right">{right}</div>}
      </div>
      {children}
    </header>
  )
}
