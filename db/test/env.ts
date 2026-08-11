import { config } from 'dotenv'

config({ path: '.env.local' })

/**
 * La guarda que separa un `npm run test:db` distraído de borrar la temporada
 * del grupo.
 *
 * Estas suites son DESTRUCTIVAS a propósito: crean y borran temporadas con
 * `service_role`, que saltea RLS, y dejan más de cien filas de basura. Y leen
 * la MISMA variable que la app, `NEXT_PUBLIC_SUPABASE_URL`, así que apuntarla a
 * la base de producción para probar una pantalla y olvidarse de volverla atrás
 * es todo lo que hace falta para perder el año del campeonato.
 *
 * Vive en el `setupFiles` de `vitest.db.config.ts` y no en un `pretest:db` de
 * npm porque así también corta un `npx vitest run --config ...` directo, que es
 * como se corre un archivo suelto mientras se desarrolla.
 *
 * `dotenv` no pisa lo que ya está en el entorno, así que una variable puesta a
 * mano en la línea de comando gana — y también pasa por acá.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
let host = ''
try {
  // `new URL('http://[::1]:54321').hostname` devuelve los corchetes puestos.
  host = new URL(raw).hostname.replace(/^\[|\]$/g, '')
} catch {
  host = ''
}

if (!LOCAL_HOSTS.has(host)) {
  throw new Error(
    [
      'Los tests contra la base sólo corren contra Supabase local.',
      '',
      `  NEXT_PUBLIC_SUPABASE_URL apunta a: ${raw === '' ? '(vacío)' : raw}`,
      '',
      'Estas suites BORRAN y crean datos con service_role. Corriéndolas contra',
      'una base real se pierde el campeonato entero.',
      '',
      'Levantá la local con `npm run db:start` y apuntá .env.local ahí',
      '(http://127.0.0.1:54321).',
    ].join('\n'),
  )
}
