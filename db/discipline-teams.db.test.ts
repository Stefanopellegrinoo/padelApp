import { describe, expect, it } from 'vitest'
import { createTeam, deleteTeam, teamsOf } from './discipline-teams'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser } from './test/users'

/** playerIds sueltos, sin usuario: alcanza para llenar `squad` de la factory. */
async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Relleno de test ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
}

/** `disciplines.fixed_teams` nace en `false` (0068) -- los tests que lo necesitan en `true` lo prenden a mano, como `fixed-teams.db.test.ts` ya hace. */
async function setFixedTeams(disciplineId: string, value: boolean): Promise<void> {
  const { error } = await adminClient().from('disciplines').update({ fixed_teams: value }).eq('id', disciplineId)
  if (error) throw new Error(error.message)
}

// ── `createTeam`/`deleteTeam` (db/discipline-teams.ts) ──────────────────────
// `fixed-teams.db.test.ts` ya prueba las constraints de `discipline_teams`
// contra `adminClient()` (service_role, saltea RLS y la capa de app). Este
// archivo prueba EL ESCRITOR -- el único camino de producción que arma o
// deshace un equipo -- contra `admin.client` (autenticado, sujeto a RLS de
// punta a punta), y que cada mensaje de error esté en castellano.

describe('createTeam — arma un equipo (docs/tipos-de-torneo.md §1)', () => {
  it('arma el equipo y aparece en teamsOf', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b] = entryIds
    if (a === undefined || b === undefined) throw new Error('Falta el plantel.')

    await createTeam(admin.client, disciplineId, seasonId, a, b)

    const teams = await teamsOf(admin.client, disciplineId)
    expect(teams).toHaveLength(1)
    expect([teams[0]?.entryA, teams[0]?.entryB].sort()).toEqual([a, b].sort())
  })

  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el `if not coalesce(v_fixed_teams, false) then raise exception
  // ...` de `create_discipline_team` (`0079_create_discipline_team.sql`) →
  // este test da ROJO (resuelve en vez de rechazar), y queda una fila de
  // `discipline_teams` que `pairingContextFor` (`db/matchday.ts:199-201`)
  // nunca lee porque `fixed_teams` sigue en `false` -- un equipo inerte,
  // sin ningún aviso.
  it('rechaza cuando la disciplina no es de equipos fijos', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    const [a, b] = entryIds
    if (a === undefined || b === undefined) throw new Error('Falta el plantel.')
    // `fixed_teams` sigue en su default (`false`, 0068:24) -- no se toca.

    await expect(createTeam(admin.client, disciplineId, seasonId, a, b)).rejects.toThrow(
      'Esta disciplina no es de equipos fijos.',
    )
  })

  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el `if (error.code === '23514') {...}` de `createTeam` → este test
  // da ROJO, con el mensaje crudo de Postgres a la vista ('new row for
  // relation "discipline_teams" violates check constraint
  // "discipline_teams_check"').
  it('rechaza a la misma persona dos veces (23514), en castellano', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a] = entryIds
    if (a === undefined) throw new Error('Falta el plantel.')

    await expect(createTeam(admin.client, disciplineId, seasonId, a, a)).rejects.toThrow(
      'Un equipo no puede ser la misma persona dos veces.',
    )
  })

  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el `if (error.code === '23503') {...}` de `createTeam` → este test
  // da ROJO, con el mensaje crudo de Postgres a la vista (violación de la FK
  // compuesta contra `discipline_entries`).
  it('rechaza a alguien que no juega esta disciplina (23503), en castellano', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineIds } = await createSeason({
      admin,
      squad: players,
      disciplines: [{}, { kind: 'FIFA' }],
    })
    const [primera, segunda] = disciplineIds
    if (primera === undefined || segunda === undefined) throw new Error('Faltan disciplinas.')
    await setFixedTeams(segunda, true)
    const [companero, forastero] = [entryIds[0], entryIds[3]]
    if (companero === undefined || forastero === undefined) throw new Error('Falta el plantel.')

    // Saca a `forastero` de la SEGUNDA disciplina -- sigue jugando la
    // primera (mismo criterio que `fixed-teams.db.test.ts`, no deja un
    // `entries` huérfano en la base compartida de la suite).
    await adminClient().from('discipline_entries').delete().eq('discipline_id', segunda).eq('entry_id', forastero)

    await expect(createTeam(admin.client, segunda, seasonId, companero, forastero)).rejects.toThrow(
      'Los dos tienen que jugar esta disciplina para poder armar un equipo.',
    )
  })

  // Ronda de fix — LOW-2: mismo código (23503) que el test de arriba, pero
  // OTRA constraint (`discipline_teams_discipline_id_season_id_fkey`, no
  // `_entry_a_fkey`/`_entry_b_fkey`) y por eso tiene que dar OTRO mensaje --
  // antes de este fix los dos compartían el mismo texto, que no nombra esta
  // causa. `otherSeason` es una temporada REAL que el mismo admin organiza
  // (así que `is_season_admin(p_season)` adentro de la RPC pasa), pero no es
  // la dueña de `disciplineId` -- mismo cruce que ya cierra
  // `removeFromDiscipline` del otro lado ("ronda de fix 2 — BLOQUEA 1",
  // `db/discipline-entries.db.test.ts`).
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar la distinción por `error.message.includes(...)` en `createTeam`
  // (dejar un solo mensaje para todo 23503) → este test da ROJO (el mensaje
  // pasa a ser el de "no juega esta disciplina", que es falso acá: los dos
  // SÍ juegan `disciplineId`).
  it('rechaza cuando el seasonId no es el dueño real de la disciplina (23503, season_id_fkey), con un mensaje DISTINTO del de "no juega"', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { disciplineId, entryIds } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b] = entryIds
    if (a === undefined || b === undefined) throw new Error('Falta el plantel.')
    const otherSeason = await createSeason({ admin, squad: await fillerPlayers(2) })

    await expect(createTeam(admin.client, disciplineId, otherSeason.seasonId, a, b)).rejects.toThrow(
      'La disciplina o la temporada no son válidas.',
    )
  })

  // Ronda de fix — BLOQUEA 1: el chequeo de "ya tiene equipo" vive AHORA en
  // `create_discipline_team` (0079_create_discipline_team.sql, el `exists`
  // antes del insert, adentro de la transacción con lock) -- ya no en un
  // `Set` armado en TS desde `teamsOf` (esa versión no cerraba bajo
  // concurrencia, ver el test de la carrera más abajo).
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar la cláusula `entry_a in (p_entry_a, p_entry_b)` del `exists` de
  // `create_discipline_team` (dejando sólo `entry_b in (...)`) → este test
  // da ROJO (la base LO PERMITE: ningún `unique` de `0068` cubre esta
  // mitad, `0068_fixed_teams.sql:56-58`, y sin la cláusula `entry_a` el
  // `exists` tampoco), y `b` queda en dos equipos a la vez.
  it('rechaza a alguien que YA tiene equipo, aunque cambie de lado (entry_b -> entry_a)', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(6)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b, c] = entryIds
    if (a === undefined || b === undefined || c === undefined) throw new Error('Falta el plantel.')

    await createTeam(admin.client, disciplineId, seasonId, a, b)

    // `b` fue `entry_b` del primer equipo; acá entra como `entry_a` del
    // segundo -- exercita la cláusula `entry_b in (...)` del `exists`
    // (matchea contra la columna `entry_b` YA guardada de la fila vieja).
    await expect(createTeam(admin.client, disciplineId, seasonId, b, c)).rejects.toThrow(
      'Alguien de los dos ya tiene equipo en esta disciplina.',
    )
  })

  // Dirección ESPEJO del test de arriba (ronda de fix — BLOQUEA 3: "el test
  // que rojea por el motivo equivocado" / sólo prueba una dirección). El
  // test de arriba exercita `entry_b in (...)` (matchea la columna `entry_b`
  // ya guardada); éste exercita `entry_a in (...)` (matchea la columna
  // `entry_a` ya guardada) -- son las DOS mitades del `or`, y ninguna cubre
  // a la otra.
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar la cláusula `entry_b in (p_entry_a, p_entry_b)` del `exists` de
  // `create_discipline_team` (dejando sólo `entry_a in (...)`) → el test de
  // arriba sigue en VERDE (no toca esa cláusula) pero ÉSTE da ROJO.
  it('rechaza a alguien que YA tiene equipo, en la dirección espejo (entry_a -> entry_b)', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(6)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b, c] = entryIds
    if (a === undefined || b === undefined || c === undefined) throw new Error('Falta el plantel.')

    await createTeam(admin.client, disciplineId, seasonId, a, b)

    // `a` fue `entry_a` del primer equipo; acá entra como `entry_b` del
    // segundo -- exercita la cláusula `entry_a in (...)`, la que el test de
    // arriba nunca toca.
    await expect(createTeam(admin.client, disciplineId, seasonId, c, a)).rejects.toThrow(
      'Alguien de los dos ya tiene equipo en esta disciplina.',
    )
  })

  // La carrera que el chequeo de aplicación (versión vieja, borrada en esta
  // misma ronda de fix) NO podía cerrar: dos altas que arrancan a la vez
  // para el MISMO `entryA` -- antes, las dos leían `taken = []` antes de
  // que cualquiera insertara, y las dos resolvían (medido, 7/7 rondas,
  // 100% reproducible, `b` quedaba en dos equipos). El `select ... for
  // update` de `create_discipline_team` serializa esto: la segunda llamada
  // espera a que la primera termine (commit) antes de leer nada, así que ve
  // el equipo recién creado y su `exists` la rechaza -- medido, 12/12
  // rondas contra la base real, siempre exactamente una gana y una rebota
  // con el mensaje traducido, nunca las dos.
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el `for update` del `select` de `create_discipline_team` (dejarlo
  // `select fixed_teams from disciplines where id = p_discipline;`, sin
  // lock) → vuelve a fallar como antes de esta ronda de fix: las dos
  // resuelven.
  // `(a,b)` ‖ `(b,c)`, NO `(a,b)` ‖ `(a,c)`: compartir `a` como `entryA` en
  // las dos ya lo frena `unique(discipline_id, entry_a)` SOLO, sin lock y
  // sin `exists` -- no probaría nada sobre la carrera. Compartiendo `b` en
  // ROLES DISTINTOS (entry_b de la primera, entry_a de la segunda) ningún
  // `unique` de una sola columna lo ve venir; es la MITAD sin cobertura
  // declarativa (mismo par que el test "dirección espejo" de arriba, pero
  // ahora en paralelo en vez de en secuencia) -- si esto pasa en verde sin
  // que el `exists`+lock funcionen de verdad, no hay ninguna red debajo.
  it('dos altas cruzadas ((a,b) y (b,c)) a la vez: una gana, la otra rebota con el mensaje traducido', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(6)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b, c] = entryIds
    if (a === undefined || b === undefined || c === undefined) throw new Error('Falta el plantel.')

    const results = await Promise.allSettled([
      createTeam(admin.client, disciplineId, seasonId, a, b),
      createTeam(admin.client, disciplineId, seasonId, b, c),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0]?.reason as Error).message).toBe('Alguien de los dos ya tiene equipo en esta disciplina.')
  })
})

describe('deleteTeam — deshace un equipo', () => {
  it('lo borra y deja de aparecer en teamsOf', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b] = entryIds
    if (a === undefined || b === undefined) throw new Error('Falta el plantel.')
    await createTeam(admin.client, disciplineId, seasonId, a, b)
    const [team] = await teamsOf(admin.client, disciplineId)
    if (team === undefined) throw new Error('No se armó el equipo.')

    await deleteTeam(admin.client, team.id)

    expect(await teamsOf(admin.client, disciplineId)).toEqual([])
  })

  // Ronda de fix — BLOQUEA 2: el test de arriba arma UN solo equipo, así
  // que "borró el correcto" y "borró TODOS los equipos que administra este
  // admin" son indistinguibles ahí -- medido: sacar el `.eq('id', teamId)`
  // de `deleteTeam` (`db/discipline-teams.ts`) deja pasar el test de arriba
  // en VERDE igual (con un solo equipo, un `delete` sin `where` también lo
  // borra a ÉL). Este test arma DOS equipos y afirma que el que no se toca
  // sigue vivo.
  //
  // Mutación probada a mano (revertida después, confirmando rojo → verde):
  // sacar el `.eq('id', teamId)` de `deleteTeam` → radio de daño medido con
  // el código mutado, antes -> A: 2 | B: 1, después -> A: 0 | B: 0 con un
  // solo `deleteTeam` -- este test da ROJO (`teamsOf` para el otro equipo
  // devuelve `[]` en vez de mantener su fila).
  it('con 2+ equipos, borra SOLO el que se le pide -- el otro sobrevive', async () => {
    const admin = await createTestUser()
    const players = await fillerPlayers(4)
    const { seasonId, entryIds, disciplineId } = await createSeason({ admin, squad: players })
    await setFixedTeams(disciplineId, true)
    const [a, b, c, d] = entryIds
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('Falta el plantel.')
    }
    await createTeam(admin.client, disciplineId, seasonId, a, b)
    await createTeam(admin.client, disciplineId, seasonId, c, d)
    const teams = await teamsOf(admin.client, disciplineId)
    expect(teams).toHaveLength(2)
    const [teamToDelete, teamToKeep] = teams
    if (teamToDelete === undefined || teamToKeep === undefined) throw new Error('Faltan los dos equipos.')

    await deleteTeam(admin.client, teamToDelete.id)

    const remaining = await teamsOf(admin.client, disciplineId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(teamToKeep.id)
  })

  // `count: 'exact'` (mismo motivo que `removeFromDiscipline`,
  // `db/discipline-entries.ts`): un delete que no toca ninguna fila NO es un
  // error en PostgREST. Mutación probada a mano (revertida después,
  // confirmando rojo → verde): sacar el chequeo de `count === 0` de
  // `deleteTeam` → este test da ROJO (resuelve en vez de rechazar).
  it('un id que no existe rebota, no resuelve en silencio', async () => {
    const admin = await createTestUser()
    await expect(deleteTeam(admin.client, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'No se pudo deshacer el equipo: sólo puede hacerlo quien organiza.',
    )
  })
})
