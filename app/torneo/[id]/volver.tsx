import Link from 'next/link'

/**
 * La flecha de subir un nivel.
 *
 * Vivía en el layout, o sea en las cuatro pestañas. Estaba de más: Tabla,
 * Fechas, Stats y Reglas son hermanas y se mueven entre sí con la nav de
 * abajo, así que sólo hace falta donde de verdad se sube — de la Tabla a Mis
 * torneos, y de Ajustes a la Tabla, que es de donde se entra.
 *
 * El chip se dibuja chico y el área de toque igual mide 44: el `<Link>` es la
 * caja de 44 y el `<span>` es lo que se ve. Es el mismo patrón que las cruces
 * del plantel — achicar el dibujo no tiene por qué achicar el blanco al que hay
 * que apuntar. El `-mt-1.5` se come el aire que sobra arriba, así que ocupa lo
 * que ocupa un chip chico aunque se pueda tocar como uno grande.
 */
export function Volver({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="-mt-1.5 -mb-1.5 flex min-h-[44px] w-fit items-center">
      <span className="rounded-full bg-chip px-3 py-1.5 text-[11.5px] font-bold">← {label}</span>
    </Link>
  )
}
