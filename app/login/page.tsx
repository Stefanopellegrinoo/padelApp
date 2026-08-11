import { Suspense } from 'react'
import LoginForm from './login-form'

// El formulario lee `next` y `error` de la query con `useSearchParams`, y eso
// obliga a Next a tener un límite de Suspense por encima: sin él, `npm run
// build` falla al prerenderizar. Ni `tsc` ni los tests lo ven.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
