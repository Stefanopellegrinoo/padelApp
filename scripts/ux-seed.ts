// Siembra la escena para `ux-measure.mjs` — Fase 0 de "feedback inmediato al
// tocar". Corré con: npx tsx scripts/ux-seed.ts
//
// Reusa las factories de test del repo (service_role, saltea RLS a propósito:
// es escenografía, no una aserción). El primer import es la guarda de host
// local — no es cosmético: este script escribe con service_role y, sin la
// guarda, apuntar `.env.local` a la base real por error alcanza para perder
// el campeonato.
import '../db/test/env'

import { writeFileSync, mkdirSync } from 'node:fs'
import { defaultConfig } from '../core/config'
import { adminClient } from '../db/test/admin'
import { createSeason } from '../db/test/factories'
import { createTestUser, type TestUser } from '../db/test/users'
import { createMatchday, generatePairs, openMatchday, saveResult, setAttendance } from '../db/matchday'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const PASSWORD = 'test-password-not-for-humans'
const OUT_DIR = '.ux'

async function fillerPlayers(count: number): Promise<string[]> {
  const db = adminClient()
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { data, error } = await db
      .from('players')
      .insert({ display_name: `Relleno UX ${Date.now()}-${i}-${Math.random()}` })
      .select('id')
      .single()
    if (error || data === null) throw new Error(error?.message)
    ids.push(data.id)
  }
  return ids
}

async function markAllPlaying(admin: TestUser, matchdayId: string, entryIds: string[]): Promise<void> {
  for (const entryId of entryIds) {
    await setAttendance(admin.client, matchdayId, entryId, 'PLAYING')
  }
}

async function matchesOf(matchdayId: string): Promise<{ id: string }[]> {
  const db = adminClient()
  const { data, error } = await db.from('matches').select('id').eq('matchday_id', matchdayId).order('round')
  if (error || data === null) throw new Error(error?.message)
  return data
}

async function main() {
  const config8 = defaultConfig(8)
  const admin = await createTestUser('ux-admin@padel-test.local')

  // 1) Fecha DRAFT, sin tocar: toggle de asistencia -> generar parejas -> confirmar.
  const fillerDraft = await fillerPlayers(8)
  const { seasonId: seasonDraftId } = await createSeason({ admin, config: config8, squad: fillerDraft })
  const matchdayDraftId = await createMatchday(admin.client, seasonDraftId, '2026-08-20')

  // 2) Fecha DRAFT, sin tocar: sólo controles de invitado (separada para no
  //    alterar la cuenta de plantel de la fecha 1).
  const fillerGuest = await fillerPlayers(8)
  const { seasonId: seasonGuestId } = await createSeason({ admin, config: config8, squad: fillerGuest })
  const matchdayGuestId = await createMatchday(admin.client, seasonGuestId, '2026-08-20')

  // 3) Fecha OPEN, sin resultados: "Volver al armado".
  const fillerRedraft = await fillerPlayers(8)
  const { seasonId: seasonRedraftId, entryIds: entriesRedraft } = await createSeason({
    admin,
    config: config8,
    squad: fillerRedraft,
  })
  const matchdayRedraftId = await createMatchday(admin.client, seasonRedraftId, '2026-08-20')
  await markAllPlaying(admin, matchdayRedraftId, entriesRedraft)
  await generatePairs(admin.client, matchdayRedraftId)
  await openMatchday(admin.client, matchdayRedraftId)

  // 4) Fecha OPEN, 5 de 6 partidos resueltos: "cargar resultado" completa el
  //    último y después "cerrar fecha" (también sirve para las pestañas de nav).
  const fillerClose = await fillerPlayers(8)
  const { seasonId: seasonCloseId, entryIds: entriesClose } = await createSeason({
    admin,
    config: config8,
    squad: fillerClose,
  })
  const matchdayCloseId = await createMatchday(admin.client, seasonCloseId, '2026-08-20')
  await markAllPlaying(admin, matchdayCloseId, entriesClose)
  await generatePairs(admin.client, matchdayCloseId)
  await openMatchday(admin.client, matchdayCloseId)
  const matches = await matchesOf(matchdayCloseId)
  if (matches.length < 2) throw new Error(`Esperaba varios partidos, hay ${matches.length}`)
  for (const match of matches.slice(0, -1)) {
    await saveResult(admin.client, match.id, [{ gamesA: 4, gamesB: 1 }])
  }
  const lastMatchId = matches[matches.length - 1]!.id

  const output = {
    password: PASSWORD,
    admin: { email: 'ux-admin@padel-test.local' },
    draft: {
      seasonId: seasonDraftId,
      matchdayId: matchdayDraftId,
      url: `${BASE}/torneo/${seasonDraftId}/fechas/1`,
    },
    guestDraft: {
      seasonId: seasonGuestId,
      matchdayId: matchdayGuestId,
      url: `${BASE}/torneo/${seasonGuestId}/fechas/1`,
    },
    redraft: {
      seasonId: seasonRedraftId,
      matchdayId: matchdayRedraftId,
      url: `${BASE}/torneo/${seasonRedraftId}/fechas/1`,
    },
    closeFlow: {
      seasonId: seasonCloseId,
      matchdayId: matchdayCloseId,
      lastMatchId,
      totalMatches: matches.length,
      url: `${BASE}/torneo/${seasonCloseId}/fechas/1`,
    },
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/seed-output.json`, JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
