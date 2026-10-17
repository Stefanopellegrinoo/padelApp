import { Suspense } from 'react'
import RecuperarForm from './recuperar-form'

// El formulario lee `error` de la query con `useSearchParams` (el link vencido
// vuelve acá con `?error=link`), y eso obliga a Next a tener un límite de
// Suspense por encima: sin él, `npm run build` falla al prerenderizar.
export default function RecuperarContraseñaPage() {
  return (
    <Suspense>
      <RecuperarForm />
    </Suspense>
  )
}
