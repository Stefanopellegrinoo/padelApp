import { describe, expect, it } from 'vitest'
import { fichaSeed, type DisciplineId } from '@/core'
import { ordinal } from '@/core/narrate'
import {
  cancelMatchday,
  closeMatchday,
  createMatchday,
  generatePairs,
  openMatchday,
  redraftMatchday,
  reopenMatchday,
  saveScore,
  seedAttendances,
  setAttendance,
  setMatchdayFormat,
} from './matchday'
import { updateDisciplineFormatoDefault } from './discipline'
import { closedScoresOf, matchdayScoresOf } from './read'
import { adminClient } from './test/admin'
import { createSeason } from './test/factories'
import { createTestUser, type TestUser } from './test/users'

/**
 * Bowling (S4): una fecha `RANKING` no tiene partidos. Cada presente carga su
 * total en `matchday_scores` (0109), la fecha abre sin parejas (0110) y cierra
 * con puestos y puntos compartidos (0111). Todo lo que se aserta pasa por el
 * cliente de una persona logueada, con RLS; la llave de service_role sólo
 * arma la escena.
 */

// La ficha de bowling de verdad: 6 jugadores, de a uno, puntos 10/7/5/3/2/1.
const SEED = fichaSeed('BOWLING', 6, 'INDIVIDUAL')
const POINTS = SEED.config.points

async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Bolos de test ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
}

interface Scene {
  admin: TestUser
  seasonId: string
  disciplineId: DisciplineId
  squad: string[]
  /** Un jugador del plantel con cuenta propia: el primero de `squad`. */
  player: TestUser
}

/** Una temporada de bowling de 6, con el primero del plantel logueable. */
async function bowlingSeason(): Promise<Scene> {
  const admin = await createTestUser()
  const player = await createTestUser()
  const players = [player.playerId, ...(await fillerPlayers(5))]
  const { seasonId, disciplineId, entryIds } = await createSeason({
    admin,
    config: SEED.config,
    squad: players,
    disciplines: [
      { kind: 'BOWLING', config: SEED.config, pairSize: 1, allowsDraw: false, formatoDefault: SEED.formatoDefault },
    ],
  })
  return { admin, seasonId, disciplineId, squad: entryIds, player }
}

/** Crea la fecha, marca presentes a `playing` (el resto ausente) y la abre. */
async function openFecha(scene: Scene, playing: string[]): Promise<string> {
  const { admin, seasonId, disciplineId, squad } = scene
  const matchdayId = await createMatchday(admin.client, seasonId, '2026-11-20', disciplineId)
  await seedAttendances(admin.client, matchdayId)
  for (const entryId of squad) {
    if (!playing.includes(entryId)) await setAttendance(admin.client, matchdayId, entryId, 'ABSENT')
  }
  await openMatchday(admin.client, matchdayId)
  return matchdayId
}

async function statusOf(matchdayId: string): Promise<string> {
  const { data, error } = await adminClient().from('matchdays').select('status').eq('id', matchdayId).single()
  if (error || data === null) throw new Error(error?.message)
  return data.status
}

async function awardsOf(matchdayId: string): Promise<Array<{ entry_id: string; position: number; points: number }>> {
  const { data, error } = await adminClient()
    .from('awards')
    .select('entry_id, position, points')
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return data ?? []
}

async function scoreRows(matchdayId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('matchday_scores')
    .select('entry_id', { count: 'exact', head: true })
    .eq('matchday_id', matchdayId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

const byEntry = (rows: Array<{ entry_id: string; position: number; points: number }>) =>
  Object.fromEntries(rows.map((row) => [row.entry_id, [row.position, row.points]]))

describe('la fecha de bowling nace por ranking', () => {
  it('hereda RANKING de la disciplina y no arma parejas', async () => {
    const scene = await bowlingSeason()
    const matchdayId = await createMatchday(scene.admin.client, scene.seasonId, '2026-11-20', scene.disciplineId)
    const { data } = await scene.admin.client.from('matchdays').select('formato').eq('id', matchdayId).single()
    expect(data?.formato).toEqual({ kind: 'RANKING' })

    await seedAttendances(scene.admin.client, matchdayId)
    await expect(generatePairs(scene.admin.client, matchdayId)).rejects.toThrow(
      'Esta fecha no arma parejas: cada uno carga sus pinos.',
    )
  })

  it('el formato de una fecha por ranking no se cambia, ni una de partidos pasa a ranking', async () => {
    const scene = await bowlingSeason()
    const matchdayId = await createMatchday(scene.admin.client, scene.seasonId, '2026-11-20', scene.disciplineId)
    await expect(setMatchdayFormat(scene.admin.client, matchdayId, { kind: 'ROUND_ROBIN' })).rejects.toThrow(
      'Una fecha de pinos no cambia de formato.',
    )
  })

  it('la disciplina no pasa de pinos a partidos ni de partidos a pinos', async () => {
    const scene = await bowlingSeason()
    await expect(
      updateDisciplineFormatoDefault(scene.admin.client, scene.disciplineId, { kind: 'ROUND_ROBIN' }),
    ).rejects.toThrow('El ranking por pinos es el formato de bowling: no se cambia.')

    const admin = await createTestUser()
    const { disciplineId } = await createSeason({ admin, disciplines: [{ kind: 'FIFA', pairSize: 1 }] })
    await expect(updateDisciplineFormatoDefault(admin.client, disciplineId, { kind: 'RANKING' })).rejects.toThrow(
      'El ranking por pinos es el formato de bowling: no se cambia.',
    )
    // Lo de siempre sigue andando: una disciplina de partidos cambia entre sus formatos.
    await updateDisciplineFormatoDefault(admin.client, disciplineId, { kind: 'ROUND_ROBIN' })
  })

  it('la base no deja una fecha ni una disciplina por ranking de a dos', async () => {
    const admin = await createTestUser()
    const { seasonId } = await createSeason({ admin })
    const db = adminClient()
    const discipline = await db
      .from('disciplines')
      .insert({ season_id: seasonId, kind: 'TEJO', config: SEED.config as never, position: 1, pair_size: 2, formato_default: { kind: 'RANKING' } })
    expect(discipline.error?.message).toContain('disciplines_ranking_individual')

    const { data: padel } = await db.from('disciplines').select('id').eq('season_id', seasonId).single()
    const matchday = await db
      .from('matchdays')
      .insert({ season_id: seasonId, discipline_id: padel!.id, number: 1, pair_size: 2, formato: { kind: 'RANKING' } })
    expect(matchday.error?.message).toContain('matchdays_ranking_individual')
  })
})

describe('abrir una fecha por ranking (0110)', () => {
  it('abre sin parejas con dos o más presentes', async () => {
    const scene = await bowlingSeason()
    const matchdayId = await openFecha(scene, scene.squad.slice(0, 4))
    expect(await statusOf(matchdayId)).toBe('OPEN')
    const { count } = await adminClient().from('pairs').select('id', { count: 'exact', head: true }).eq('matchday_id', matchdayId)
    expect(count).toBe(0)
  })

  it('con uno solo presente no abre, y la base lo rechaza aunque se saltee la app', async () => {
    const scene = await bowlingSeason()
    const matchdayId = await createMatchday(scene.admin.client, scene.seasonId, '2026-11-20', scene.disciplineId)
    await seedAttendances(scene.admin.client, matchdayId)
    for (const entryId of scene.squad.slice(1)) await setAttendance(scene.admin.client, matchdayId, entryId, 'ABSENT')

    await expect(openMatchday(scene.admin.client, matchdayId)).rejects.toThrow(
      'Hacen falta al menos dos presentes para abrir la fecha.',
    )
    const { error } = await scene.admin.client.rpc('open_matchday', { p_matchday: matchdayId })
    expect(error?.message).toBe('Hacen falta al menos dos presentes para abrir la fecha.')
    expect(await statusOf(matchdayId)).toBe('DRAFT')
  })

  it('una fecha de pádel sin parejas sigue sin abrir, con el mismo mensaje de siempre', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId } = await createSeason({ admin, squad: await fillerPlayers(4) })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-11-20', disciplineId)
    const { error } = await admin.client.rpc('open_matchday', { p_matchday: matchdayId })
    expect(error?.message).toBe('Generá las parejas antes de abrir la fecha.')
  })
})

describe('los pinos (matchday_scores, 0109)', () => {
  it('quien organiza carga y corrige los pinos de un presente', async () => {
    const scene = await bowlingSeason()
    const [a, b] = scene.squad
    const matchdayId = await openFecha(scene, scene.squad.slice(0, 3))
    await saveScore(scene.admin.client, matchdayId, a!, 150)
    await saveScore(scene.admin.client, matchdayId, b!, 99)
    await saveScore(scene.admin.client, matchdayId, a!, 180)
    expect(await matchdayScoresOf(scene.admin.client, matchdayId)).toEqual(new Map([[a, 180], [b, 99]]))
  })

  it('fuera de 0 a 9999 no se guarda, ni por la app ni directo contra la base', async () => {
    const scene = await bowlingSeason()
    const [a] = scene.squad
    const matchdayId = await openFecha(scene, scene.squad.slice(0, 3))
    for (const bad of [-1, 10000, 1.5, Number.NaN]) {
      await expect(saveScore(scene.admin.client, matchdayId, a!, bad)).rejects.toThrow(
        'Los pinos van de 0 a 9999, sin decimales.',
      )
    }
    const direct = await scene.admin.client
      .from('matchday_scores')
      .insert({ matchday_id: matchdayId, entry_id: a!, season_id: scene.seasonId, score: 10000 })
    expect(direct.error?.message).toContain('matchday_scores_score_range')
    expect(await scoreRows(matchdayId)).toBe(0)
  })

  it('un ausente no tiene pinos', async () => {
    const scene = await bowlingSeason()
    const absent = scene.squad[5]!
    const matchdayId = await openFecha(scene, scene.squad.slice(0, 3))
    await expect(saveScore(scene.admin.client, matchdayId, absent, 120)).rejects.toThrow(
      'No se pudieron guardar los pinos',
    )
    expect(await scoreRows(matchdayId)).toBe(0)
  })

  it('en armado no se cargan pinos', async () => {
    const scene = await bowlingSeason()
    const matchdayId = await createMatchday(scene.admin.client, scene.seasonId, '2026-11-20', scene.disciplineId)
    await seedAttendances(scene.admin.client, matchdayId)
    await expect(saveScore(scene.admin.client, matchdayId, scene.squad[0]!, 120)).rejects.toThrow(
      'Los pinos se cargan con la fecha en juego.',
    )
    const direct = await scene.admin.client
      .from('matchday_scores')
      .insert({ matchday_id: matchdayId, entry_id: scene.squad[0]!, season_id: scene.seasonId, score: 120 })
    expect(direct.error).not.toBeNull()
    expect(await scoreRows(matchdayId)).toBe(0)
  })

  it('un jugador del torneo carga sólo con "los jugadores cargan" prendido', async () => {
    const scene = await bowlingSeason()
    const [mine, other] = scene.squad
    const matchdayId = await openFecha(scene, scene.squad.slice(0, 3))

    await expect(saveScore(scene.player.client, matchdayId, other!, 120)).rejects.toThrow(
      'No se pudieron guardar los pinos',
    )
    expect(await scoreRows(matchdayId)).toBe(0)

    await adminClient().from('seasons').update({ players_can_score: true }).eq('id', scene.seasonId)
    await saveScore(scene.player.client, matchdayId, other!, 120)
    await saveScore(scene.player.client, matchdayId, mine!, 130)
    expect(await matchdayScoresOf(scene.player.client, matchdayId)).toEqual(new Map([[other, 120], [mine, 130]]))
  })

  it('alguien de afuera no los ve ni los escribe', async () => {
    const scene = await bowlingSeason()
    const stranger = await createTestUser()
    const matchdayId = await openFecha(scene, scene.squad.slice(0, 3))
    await saveScore(scene.admin.client, matchdayId, scene.squad[0]!, 100)

    expect(await matchdayScoresOf(stranger.client, matchdayId)).toEqual(new Map())
    const direct = await stranger.client
      .from('matchday_scores')
      .insert({ matchday_id: matchdayId, entry_id: scene.squad[1]!, season_id: scene.seasonId, score: 300 })
    expect(direct.error).not.toBeNull()
    expect(await scoreRows(matchdayId)).toBe(1)
  })

  it('una fecha de partidos no acepta pinos', async () => {
    const admin = await createTestUser()
    const { seasonId, disciplineId, entryIds } = await createSeason({
      admin,
      config: SEED.config,
      squad: await fillerPlayers(4),
      disciplines: [{ kind: 'FIFA', config: SEED.config, pairSize: 1 }],
    })
    const matchdayId = await createMatchday(admin.client, seasonId, '2026-11-20', disciplineId)
    await seedAttendances(admin.client, matchdayId)
    await generatePairs(admin.client, matchdayId)
    await openMatchday(admin.client, matchdayId)
    const direct = await admin.client
      .from('matchday_scores')
      .insert({ matchday_id: matchdayId, entry_id: entryIds[0]!, season_id: seasonId, score: 120 })
    expect(direct.error).not.toBeNull()
    await expect(saveScore(admin.client, matchdayId, entryIds[0]!, 120)).rejects.toThrow(
      'Esta fecha no es de pinos.',
    )
  })
})

describe('cerrar una fecha por ranking (0111)', () => {
  it('dos con 180 quedan los dos 2° con los puntos del 2°, y el siguiente queda 4° (S4)', async () => {
    const scene = await bowlingSeason()
    const [a, b, c, d] = scene.squad
    const matchdayId = await openFecha(scene, [a!, b!, c!, d!])
    await saveScore(scene.admin.client, matchdayId, a!, 200)
    await saveScore(scene.admin.client, matchdayId, b!, 180)
    await saveScore(scene.admin.client, matchdayId, c!, 180)
    await saveScore(scene.admin.client, matchdayId, d!, 150)

    await closeMatchday(scene.admin.client, matchdayId)

    expect(await statusOf(matchdayId)).toBe('CLOSED')
    expect(byEntry(await awardsOf(matchdayId))).toEqual({
      [a!]: [1, POINTS[0]],
      [b!]: [2, POINTS[1]],
      [c!]: [2, POINTS[1]],
      [d!]: [4, POINTS[3]],
    })
    const { data: lines } = await adminClient()
      .from('award_lines')
      .select('entry_id, reason, points')
      .eq('matchday_id', matchdayId)
      .eq('entry_id', c!)
    expect(lines).toEqual([{ entry_id: c, reason: `${ordinal(2)} de la fecha`, points: POINTS[1] }])
  })

  it('con pinos sin cargar no cierra, y la fecha sigue en juego', async () => {
    const scene = await bowlingSeason()
    const [a, b, c] = scene.squad
    const matchdayId = await openFecha(scene, [a!, b!, c!])
    await saveScore(scene.admin.client, matchdayId, a!, 200)

    await expect(closeMatchday(scene.admin.client, matchdayId)).rejects.toThrow('Faltan los pinos de 2 jugadores.')

    // Directo contra la base, con los puntos que pagaría el que sí cargó.
    const { error } = await scene.admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [{ entryId: a, position: 1, points: POINTS[0], lines: [{ reason: '1° de la fecha', points: POINTS[0] }] }],
    })
    expect(error?.message).toBe('Faltan pinos por cargar.')
    expect(await statusOf(matchdayId)).toBe('OPEN')
    expect(await awardsOf(matchdayId)).toEqual([])
  })

  it('la base rechaza puestos que no salen de los pinos, aunque se saltee la app', async () => {
    const scene = await bowlingSeason()
    const [a, b, c] = scene.squad
    const matchdayId = await openFecha(scene, [a!, b!, c!])
    await saveScore(scene.admin.client, matchdayId, a!, 180)
    await saveScore(scene.admin.client, matchdayId, b!, 180)
    await saveScore(scene.admin.client, matchdayId, c!, 100)

    const award = (entryId: string, position: number, points: number) => ({
      entryId,
      position,
      points,
      lines: [{ reason: `${position}° de la fecha`, points }],
    })
    const attempts = [
      // Desempatado en vez de compartido: el 2° tenía que ser 1°.
      [award(a!, 1, POINTS[0]!), award(b!, 2, POINTS[1]!), award(c!, 3, POINTS[2]!)],
      // Puesto bien, puntos de otro puesto.
      [award(a!, 1, POINTS[0]!), award(b!, 1, POINTS[1]!), award(c!, 3, POINTS[2]!)],
      // Falta uno de los presentes.
      [award(a!, 1, POINTS[0]!), award(b!, 1, POINTS[0]!)],
    ]
    for (const awards of attempts) {
      const { error } = await scene.admin.client.rpc('close_matchday', { p_matchday: matchdayId, p_awards: awards })
      expect(error?.message).toBe('Los puestos o los puntos no salen de los pinos cargados.')
    }
    // Puntos para un ausente.
    const { error } = await scene.admin.client.rpc('close_matchday', {
      p_matchday: matchdayId,
      p_awards: [award(a!, 1, POINTS[0]!), award(b!, 1, POINTS[0]!), award(c!, 3, POINTS[2]!), award(scene.squad[5]!, 4, POINTS[3]!)],
    })
    expect(error?.message).toBe('Hay puntos para alguien que no jugó esta fecha.')

    expect(await statusOf(matchdayId)).toBe('OPEN')
    expect(await awardsOf(matchdayId)).toEqual([])
  })

  it('un jugador no cierra la fecha aunque cargue pinos', async () => {
    const scene = await bowlingSeason()
    const [a, b] = scene.squad
    await adminClient().from('seasons').update({ players_can_score: true }).eq('id', scene.seasonId)
    const matchdayId = await openFecha(scene, [a!, b!])
    await saveScore(scene.player.client, matchdayId, a!, 120)
    await saveScore(scene.player.client, matchdayId, b!, 110)
    await expect(closeMatchday(scene.player.client, matchdayId)).rejects.toThrow(
      'Sólo quien organiza la temporada puede cerrar una fecha.',
    )
    expect(await statusOf(matchdayId)).toBe('OPEN')
  })
})

describe('reabrir, volver al armado y borrar una fecha por ranking', () => {
  it('reabrir borra los puntos y deja los pinos para corregir y volver a cerrar', async () => {
    const scene = await bowlingSeason()
    const [a, b] = scene.squad
    const matchdayId = await openFecha(scene, [a!, b!])
    await saveScore(scene.admin.client, matchdayId, a!, 120)
    await saveScore(scene.admin.client, matchdayId, b!, 110)
    await closeMatchday(scene.admin.client, matchdayId)

    await reopenMatchday(scene.admin.client, matchdayId)
    expect(await statusOf(matchdayId)).toBe('OPEN')
    expect(await awardsOf(matchdayId)).toEqual([])
    expect(await matchdayScoresOf(scene.admin.client, matchdayId)).toEqual(new Map([[a, 120], [b, 110]]))

    await saveScore(scene.admin.client, matchdayId, b!, 130)
    await closeMatchday(scene.admin.client, matchdayId)
    expect(byEntry(await awardsOf(matchdayId))).toEqual({ [b!]: [1, POINTS[0]], [a!]: [2, POINTS[1]] })
  })

  it('volver al armado conserva los pinos; quien se baja no cuenta al cerrar', async () => {
    const scene = await bowlingSeason()
    const [a, b, c] = scene.squad
    const matchdayId = await openFecha(scene, [a!, b!, c!])
    await saveScore(scene.admin.client, matchdayId, a!, 120)
    await saveScore(scene.admin.client, matchdayId, b!, 110)
    await saveScore(scene.admin.client, matchdayId, c!, 200)

    await redraftMatchday(scene.admin.client, matchdayId)
    expect(await statusOf(matchdayId)).toBe('DRAFT')
    expect(await scoreRows(matchdayId)).toBe(3)

    await setAttendance(scene.admin.client, matchdayId, c!, 'ABSENT')
    await openMatchday(scene.admin.client, matchdayId)
    expect(await matchdayScoresOf(scene.admin.client, matchdayId)).toEqual(new Map([[a, 120], [b, 110], [c, 200]]))
    await closeMatchday(scene.admin.client, matchdayId)
    expect(byEntry(await awardsOf(matchdayId))).toEqual({ [a!]: [1, POINTS[0]], [b!]: [2, POINTS[1]] })
  })

  it('borrar la fecha se lleva los pinos', async () => {
    const scene = await bowlingSeason()
    const [a, b] = scene.squad
    const matchdayId = await openFecha(scene, [a!, b!])
    await saveScore(scene.admin.client, matchdayId, a!, 120)
    await cancelMatchday(scene.admin.client, matchdayId)
    expect(await scoreRows(matchdayId)).toBe(0)
  })
})

describe('closedScoresOf: los pinos que contaron, para Stats y el perfil', () => {
  it('por número de fecha, sólo cerradas, sólo de quien jugó', async () => {
    const scene = await bowlingSeason()
    const [a, b, c] = scene.squad
    const first = await openFecha(scene, [a!, b!, c!])
    await saveScore(scene.admin.client, first, a!, 120)
    await saveScore(scene.admin.client, first, b!, 110)
    await saveScore(scene.admin.client, first, c!, 200)
    // `c` se baja después de cargar: sus pinos quedan guardados pero no cuentan.
    await redraftMatchday(scene.admin.client, first)
    await setAttendance(scene.admin.client, first, c!, 'ABSENT')
    await openMatchday(scene.admin.client, first)
    await closeMatchday(scene.admin.client, first)

    // La 2 está en juego: todavía no cuenta.
    const second = await openFecha(scene, [a!, b!])
    await saveScore(scene.admin.client, second, a!, 300)

    expect(await closedScoresOf(scene.admin.client, scene.disciplineId)).toEqual(
      new Map([[1, new Map([[a, 120], [b, 110]])]]),
    )
  })
})

describe('la factory no deja temporadas huérfanas', () => {
  it('si la disciplina rebota, la temporada recién creada se borra y el error sigue', async () => {
    const admin = await createTestUser()
    await expect(
      createSeason({ admin, disciplines: [{ kind: 'TEJO', pairSize: 2, formatoDefault: { kind: 'RANKING' } }] }),
    ).rejects.toThrow('No se pudo crear la disciplina de test')
    const { count, error } = await adminClient()
      .from('seasons')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', admin.userId)
    if (error) throw new Error(error.message)
    expect(count).toBe(0)
  })
})
