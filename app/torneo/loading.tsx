import Esqueleto from './[id]/loading'

/**
 * El esqueleto al ENTRAR a un torneo.
 *
 * El de `[id]/loading.tsx` vive adentro del layout del torneo, y ese layout
 * espera a `getUser` y al encabezado de la temporada antes de pintar: entrando
 * desde Mis torneos no se veía nada hasta que terminaban esas dos consultas.
 * Éste envuelve al layout, así que aparece al instante. Entre pestañas no
 * corre: el layout queda montado y sigue mandando el de adentro.
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <main className="flex-1 px-5 pb-6">
        <Esqueleto />
      </main>
    </div>
  )
}
