import { Suspense } from 'react'
import RegistroForm from './registro-form'

// Mismo motivo que en `/login`: el formulario lee `next` de la query con
// `useSearchParams` y necesita un límite de Suspense por encima para que el
// build pueda prerenderizar la página.
export default function RegistroPage() {
  return (
    <Suspense>
      <RegistroForm />
    </Suspense>
  )
}
