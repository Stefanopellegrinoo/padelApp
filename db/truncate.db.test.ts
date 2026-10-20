import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// TRUNCATE no se alcanza desde PostgREST (no lo expone), así que se verifica
// contra la Postgres local con `psql`, mismo patrón que `db/masters.db.test.ts`.
function localSql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec', '-i', 'supabase_db_padelApp',
      'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' },
  )
}

// `has_table_privilege` con el OID de la tabla, no con el nombre: con el nombre
// (`'public.' || tablename`) la función resuelve el nombre por search_path y
// truena en `auth.instances` ("relation public.instances does not exist"), que
// no está en `public`. El OID no resuelve nada, sólo consulta el ACL.
const publicTables = `from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`

describe('TRUNCATE revocado (S2, 0100)', () => {
  it('authenticated no puede truncar ninguna tabla pública', () => {
    const tablesWithTruncate = localSql(`
      select c.relname
        ${publicTables}
         and has_table_privilege('authenticated', c.oid, 'TRUNCATE')
       order by c.relname;
    `).trim()
    expect(tablesWithTruncate).toBe('')
  })

  it('service_role conserva TRUNCATE en todas las tablas públicas', () => {
    const total = Number(localSql(`select count(*) ${publicTables};`).trim())
    const withTruncate = Number(
      localSql(`
        select count(*)
          ${publicTables}
           and has_table_privilege('service_role', c.oid, 'TRUNCATE');
      `).trim(),
    )
    expect(total).toBeGreaterThan(0)
    expect(withTruncate).toBe(total)
  })

  it('un truncate real como authenticated falla (y no deja nada a medias)', () => {
    // El begin/rollback protege: si el revoke no aplicara y el truncate pasara,
    // el rollback lo deshace. Si falla (lo esperado), la transacción se aborta.
    expect(() =>
      localSql(`begin; set role authenticated; truncate table public.match_sets; rollback;`),
    ).toThrow(/permission denied|must be owner|TRUNCATE/i)
  })
})
