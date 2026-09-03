import type { DisciplineId, MatchdayFormat, SeasonConfig, SideSize } from '@/core'
import type { Client } from './client'
import type { Json } from './database.types'
import { EdgeError } from './errors'
import { defaultDisciplineId, squadSeedOrder } from './season'
import { assertValidConfig } from './validate'

/** `disciplineConfig`'s return: la config Y el `pair_size`/`allows_draw` reales, del mismo select. */
export interface DisciplineConfigRow {
  config: SeasonConfig
  pairSize: SideSize
  /**
   * El `allows_draw` real de la disciplina (W61),
   * leído del mismo select que ya trae `config` y `pair_size` — ningún select
   * nuevo, misma razón por la que `pairSize` vive acá desde W30.
   */
  allowsDraw: boolean
  /**
   * El `fixed_teams` real de la disciplina (0068, docs/tipos-de-torneo.md §1),
   * del mismo select y por el mismo motivo que `allowsDraw`. Decide si la
   * fecha ROTA parejas o si los equipos ya vienen dados.
   */
  fixedTeams: boolean
  /**
   * El `formato_default` real de la disciplina (0074, docs/tipos-de-torneo.md
   * §2.5), del mismo select y por el mismo motivo que `allowsDraw`/
   * `fixedTeams`. `createMatchday` (`db/matchday.ts`) lo usa como `formato`
   * de la fecha nueva; la fecha lo sigue pudiendo pisar después con
   * `setMatchdayFormat`.
   */
  formatoDefault: MatchdayFormat
}

/**
 * La config de UNA disciplina — `disciplines.config`, no `seasons.config` —
 * MÁS `pair_size`, de la misma fila y el mismo select (W30,
 * ronda 9): antes esta función sólo traía `config` y tres call sites
 * (`matchdayContextFor`, `pairingContextFor`, `DISCIPLINE_HEADER_COLUMNS` en
 * db/read.ts) pasaban un `2` literal a `assertValidConfig`/`assertMatchdaySize`
 * aunque el valor real estaba a una columna de un select que ya corría.
 *
 * `disciplines.config` existe desde PR 1 (0015), backfillada 1:1 con la
 * config de la temporada en ese momento, pero hasta PR 5 nada la volvía a
 * escribir: `updateSeasonConfig` (db/season.ts) sólo toca `seasons.config`,
 * así que dos disciplinas de la misma temporada podían divergir de la
 * temporada sin que ninguna pantalla lo viera. De acá en más ésta es la
 * fuente real, por disciplina, sin herencia cruzada (REQ-D2-1).
 */
export async function disciplineConfig(
  supabase: Client,
  disciplineId: DisciplineId,
): Promise<DisciplineConfigRow> {
  const { data, error } = await supabase
    .from('disciplines')
    .select('config, pair_size, allows_draw, fixed_teams, formato_default')
    .eq('id', disciplineId)
    .maybeSingle()
  if (error) {
    throw new EdgeError(`No se pudo leer la configuración de la disciplina: ${error.message}`)
  }
  if (data === null) throw new EdgeError('La disciplina no existe.')
  return {
    config: data.config as unknown as SeasonConfig,
    pairSize: data.pair_size as SideSize,
    allowsDraw: data.allows_draw,
    fixedTeams: data.fixed_teams,
    formatoDefault: data.formato_default as unknown as MatchdayFormat,
  }
}

/**
 * El único escritor de `disciplines.config`: `assertValidConfig` corre antes que el update, igual que `updateSeasonConfig`.
 *
 * C20: el `sideSize` estaba HARDCODEADO en 2, y sobre
 * una disciplina de a uno eso dejaba la validación invertida — rechazaba la
 * única config válida (8 valores de puntos para 8 asientos) y aceptaba la de
 * parejas (4), que después `matchdayContextFor` rechaza al armar y al cerrar.
 * Una fecha OPEN con resultados quedaba sin poder cerrarse Y sin poder volver
 * atrás desde Ajustes, porque el rollback chocaba contra este mismo `2`.
 *
 * El `pair_size` se LEE acá adentro en vez de recibirse por parámetro, a
 * propósito: es identidad de la disciplina, no una opción de quien llama. Con
 * un parámetro, cada call site presente y futuro puede pasar el equivocado y
 * el compilador no lo nota —`SideSize` es `1 | 2` en los dos casos—, que es
 * exactamente la clase de bug por la que `DisciplineId` está branded (N2,
 * ronda 2). Leerlo cuesta un SELECT por guardado en una pantalla de admin;
 * `disciplineConfig`, justo arriba, ya trae la fila que hace falta.
 *
 * S46: `count: 'exact'` por el mismo motivo que
 * `setMatchdayDate` (`db/matchday.ts:198-200`) — un update que no toca ninguna
 * fila NO es un error en PostgREST. `saveDisciplineConfig` no tiene chequeo de
 * admin propio, se apoya en RLS, y un participante que NO organiza pasa el
 * `select` de `disciplineConfig` (`disciplines_read` usa `is_participant`) y
 * después su update matchea 0 filas contra `disciplines_write` (que usa
 * `is_season_admin`). Sin esto la pantalla le decía que guardó y al recargar
 * volvía la config vieja.
 *
 * C23: desde `0032_promote_guest_points_slot.sql` la
 * BASE también escribe `disciplines.config` —al promover un invitado de a uno
 * agrega un casillero de puntos y sube `squadSize`—, y esta función era un
 * overwrite CIEGO del blob entero. Con Formato abierto en una pestaña y una
 * promoción en otra, el primer toque del admin pisaba el casillero recién
 * agregado sin un solo error en pantalla, y la fecha volvía a quedar sin poder
 * cerrarse (C22).
 *
 * El guard compara el LARGO de `points` y `squadSize`, que son exactamente los
 * dos campos que la app se escribe a sí misma. Formato edita VALORES —no tiene
 * control para agregar o sacar un puesto, ni para mover el plantel—, así que
 * una diferencia ahí no puede venir del formulario: sólo de que la fila cambió
 * abajo mientras estaba abierto.
 *
 * ponytail: esto detecta que cambió la FORMA (cuántos puntos, cuántos del
 * plantel), no que se haya perdido una edición. `SeasonConfig` tiene 6 campos
 * y acá se miran 2, así que dos organizadores editando A LA VEZ los VALORES
 * —uno pone los puntos en `[12,7,5]` y el otro en `[10,8,5]`— pasan los dos:
 * mismo largo, mismo `squadSize`, gana el último y en silencio.
 *
 * Y NO se arregla comparando la config entera contra `vigente`: la config que
 * llega es la NUEVA, así que cualquier edición legítima difiere. Un lock
 * optimista de verdad necesita saber DE QUÉ PARTIÓ el cliente, y hoy
 * `saveConfig` (`app/torneo/[id]/ajustes/actions.ts`) manda sólo la nueva.
 *
 * Dos upgrades reales, medidos, el día que haga falta:
 *   · que el cliente mande también la config que leyó y comparar ESA contra
 *     `vigente` — ~15 líneas en 3 archivos, sin tocar el schema;
 *   · una columna de versión en `disciplines` — más sólido, pero pide
 *     migración propia, que desde el push ya no es gratis (#3981).
 *
 * Se acepta el techo porque hoy hay UN organizador por torneo: dos editando el
 * mismo formato en el mismo momento no es un escenario que exista todavía.
 */
export async function updateDisciplineConfig(
  supabase: Client,
  disciplineId: DisciplineId,
  config: SeasonConfig,
): Promise<void> {
  const { config: vigente, pairSize } = await disciplineConfig(supabase, disciplineId)
  // La validez del payload se chequea PRIMERO, y el orden importa: una config
  // con la cantidad equivocada de puntos y una armada sobre una fila vieja se
  // ven iguales desde acá (las dos tienen otro largo), pero la primera es un
  // error de contenido y merece el mensaje de `validateConfig`, que dice
  // cuántos valores hacen falta. Con el orden al revés, ese mensaje quedaba
  // tapado por el de concurrencia.
  assertValidConfig(config, pairSize)
  if (
    config.points.length !== vigente.points.length ||
    config.squadSize !== vigente.squadSize
  ) {
    // Antes el mensaje decía "—alguien sumó un jugador
    // al plantel—". El guard dispara ante CUALQUIER diferencia de largo o de
    // `squadSize`, en cualquier dirección; hoy la causa es cierta sólo porque
    // el único escritor automático suma, y el `ponytail:` de arriba dice que va
    // a haber más. Sin la causa dice lo mismo y no envejece.
    throw new EdgeError(
      'La configuración cambió mientras editabas. Recargá la pantalla y volvé a aplicar el cambio.',
    )
  }
  const { error, count } = await supabase
    .from('disciplines')
    .update({ config: config as unknown as Json }, { count: 'exact' })
    .eq('id', disciplineId)
  if (error) {
    throw new EdgeError(`No se pudo actualizar la configuración de la disciplina: ${error.message}`)
  }
  if (count === 0) {
    throw new EdgeError('No se pudo guardar el formato: sólo puede hacerlo quien organiza.')
  }
}

/**
 * El único escritor de `disciplines.has_masters` DESPUÉS de creada la
 * disciplina — decisión #4029, parte 2 ("editable en Ajustes"). La parte 1
 * (automático al crear, por `pair_size`) vive en `addDiscipline` y
 * `createSeason` (`db/season.ts`); ésta es la que mueve el valor cuando el
 * organizador lo cambia después.
 *
 * El guard de la parte 3 (no se puede ENCENDER el Masters en una disciplina
 * de a uno — `generateMastersPairs`, `db/matchday.ts`, rechaza siempre
 * `pair_size=1`) vive ACÁ y TAMBIÉN en la base
 * (`disciplines_has_masters_needs_pair`, 0053): `grant update (..., has_masters,
 * ...)` (`0015_disciplines.sql:70`) es de COLUMNA, no de función, así que un
 * `PATCH` directo a `disciplines` saltea este `if` entero (#3989 — guards en
 * serie, el de atrás sin test propio si nadie lo mira). Este `if` sólo da un
 * mensaje legible antes de llegar al CHECK; el CHECK es el que de verdad no
 * se puede esquivar.
 *
 * Apagar el Masters de una disciplina de a uno es SIEMPRE legal (ya nace
 * así, decisión #4029 parte 1) — el guard sólo mira `hasMasters === true`,
 * nunca bloquea apagarlo.
 */
export async function updateDisciplineHasMasters(
  supabase: Client,
  disciplineId: DisciplineId,
  hasMasters: boolean,
): Promise<void> {
  if (hasMasters) {
    const { pairSize } = await disciplineConfig(supabase, disciplineId)
    if (pairSize === 1) {
      throw new EdgeError('El Masters se juega de a parejas: una disciplina de a uno no lo puede encender.')
    }
  }
  const { error, count } = await supabase
    .from('disciplines')
    .update({ has_masters: hasMasters }, { count: 'exact' })
    .eq('id', disciplineId)
  if (error) {
    throw new EdgeError(`No se pudo actualizar el Masters de la disciplina: ${error.message}`)
  }
  if (count === 0) {
    throw new EdgeError('No se pudo guardar el Masters: sólo puede hacerlo quien organiza.')
  }
}

/**
 * El único escritor de `disciplines.formato_default` (0074,
 * docs/tipos-de-torneo.md §2.5) -- mismo patrón `count: 'exact'` que
 * `updateDisciplineConfig`/`updateDisciplineHasMasters` de arriba, sin
 * chequeo de admin propio: se apoya en RLS (`disciplines_write`,
 * `is_season_admin`).
 *
 * Sin chequeo de OFRECIBILIDAD acá, a propósito: `formatoOfrecible`/
 * `offerableFormats` (`core/knockout.ts`) necesitan `sides` -- cuántos lados
 * confirmaron asistencia -- y ese dato no existe a nivel disciplina, sólo a
 * nivel fecha. Ese filtro sigue viviendo donde ya vivía, en
 * `setMatchdayFormat` (`db/matchday.ts:337`), que sí tiene una fecha con
 * asistencia real para medir contra. El CHECK `disciplines_formato_default_kind`
 * (0074) es la única validación de FORMA que corre acá, y es la que un PATCH
 * directo tampoco puede saltear -- mismo argumento que ya hace la migración
 * para el resto de sus guards.
 */
export async function updateDisciplineFormatoDefault(
  supabase: Client,
  disciplineId: DisciplineId,
  formato: MatchdayFormat,
): Promise<void> {
  const { error, count } = await supabase
    .from('disciplines')
    .update({ formato_default: formato as unknown as Json }, { count: 'exact' })
    .eq('id', disciplineId)
  if (error !== null) {
    throw new EdgeError(`No se pudo guardar el formato de las fechas: ${error.message}`)
  }
  if (count === 0) {
    throw new EdgeError('No se pudo guardar el formato: sólo puede hacerlo quien organiza.')
  }
}

/**
 * El único escritor de `disciplines.rules_text` (0069) -- reemplaza a
 * `updateSeasonRules` (`db/season.ts`, borrada en esta misma rebanada).
 * Mismo patrón que `updateDisciplineConfig`/`updateDisciplineHasMasters` de
 * arriba: `count: 'exact'`, sin chequeo de admin propio, se apoya en RLS
 * (`disciplines_write`, `is_season_admin`).
 *
 * `.eq('season_id', seasonId)` además de `.eq('id', disciplineId)` --
 * a diferencia de los dos escritores de arriba, deliberado (design rev 2
 * §4): `disciplineId` llega del cliente vía `saveRules`, un server action.
 * RLS sola deja pasar a un admin-de-dos-temporadas que arma un pedido con el
 * `seasonId` de la temporada A pero el `disciplineId` de una disciplina de
 * la B que también organiza -- porque `disciplines_write` mira el
 * `season_id` REAL de la fila, no el que viaja en el pedido. El `.eq` extra
 * hace que ese pedido no matchee ninguna fila y caiga por el mismo
 * `count === 0` que un participante sin permiso.
 *
 * Dual-write a `seasons.rules_text`, sólo en la disciplina DEFAULT
 * (`defaultDisciplineId`, mismo criterio que `season_public_rules`
 * 0022:41-42): sin esto, un `git revert` de esta rebanada perdería en
 * silencio cualquier edición hecha después del deploy, porque
 * `season_public_rules` -- viva en producción -- sigue sirviendo
 * `seasons.rules_text`. Misma postura que `seasons.config`
 * (`read.ts:73-80`): aditivo hasta el contract que borre la columna vieja.
 *
 * W2 (verify-report): este segundo update también lleva `count: 'exact'` +
 * chequeo de `count === 0`, no sólo `error !== null` -- mismo motivo que el
 * update de arriba y que el de `updateSeasonRules` (borrada acá, ronda 15:
 * "un update que no toca ninguna fila NO es un error en PostgREST"). Hoy
 * `disciplines_write` (`is_season_admin`) y `seasons_update` chequean el
 * MISMO `seasons.created_by = auth.uid()` sobre la MISMA fila que ya validó
 * el update de arriba, así que este `count === 0` no puede dispararse en
 * producción -- pero nada en el esquema OBLIGA a que sigan alineadas, y si
 * alguna vez se desalinean, un `count === 0` silencioso dejaría
 * `season_public_rules` sirviendo texto viejo sin que nadie se entere. Se
 * elige tirar (no seguir de largo): la disciplina ya quedó guardada, así
 * que el mensaje lo distingue de "no organiza".
 */
export async function updateDisciplineRules(
  supabase: Client,
  seasonId: string,
  disciplineId: DisciplineId,
  text: string,
): Promise<void> {
  const { error, count } = await supabase
    .from('disciplines')
    .update({ rules_text: text }, { count: 'exact' })
    .eq('id', disciplineId)
    .eq('season_id', seasonId)
  if (error !== null) {
    throw new EdgeError(`No se pudieron guardar las reglas: ${error.message}`)
  }
  if (count === 0) {
    throw new EdgeError('No se pudieron guardar las reglas: sólo puede hacerlo quien organiza.')
  }

  const defaultId = await defaultDisciplineId(supabase, seasonId)
  if (disciplineId !== defaultId) return
  const { error: seasonError, count: seasonCount } = await supabase
    .from('seasons')
    .update({ rules_text: text, rules_updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', seasonId)
  if (seasonError !== null) {
    throw new EdgeError(`No se pudieron guardar las reglas: ${seasonError.message}`)
  }
  if (seasonCount === 0) {
    throw new EdgeError(
      'Las reglas de la disciplina se guardaron, pero no se pudo actualizar la copia de la temporada.',
    )
  }
}

/** Una disciplina a agregar a un torneo ya en curso — `addDiscipline`, no el wizard. */
export interface NewDiscipline {
  kind?: 'PADEL' | 'FIFA'
  config: SeasonConfig
  /** Mismo contrato que `NewSeasonDiscipline` (db/season.ts): elegido al crear, no derivado de `kind`. Sin especificar, 2. */
  pairSize?: SideSize
  /** Mismo contrato que `NewSeasonDiscipline`. Sin especificar, false. */
  allowsDraw?: boolean
  /** Mismo contrato que `NewSeasonDiscipline`. Sin especificar, el automático de decisión #4029 (`false` con `pairSize: 1`, `true` si no). */
  hasMasters?: boolean
  /** Mismo contrato que `NewSeasonDiscipline`. Sin especificar, el default de columna (`ROUND_ROBIN`, 0074). */
  formatoDefault?: MatchdayFormat
}

/**
 * Agrega una disciplina a un torneo YA EN CURSO (REQ-D1-2): el `createSeason`
 * de después del wizard. No toca ninguna disciplina existente ni sus fechas
 * — es "gratis" porque `awards` queda congelado por fecha (decisión de
 * producto, #3796) y `matchdays_one_live` ya está scopeado por
 * `discipline_id` (PR 2/0016, REQ-D3-1), así que una fecha OPEN de otra
 * disciplina ni bloquea ni se entera de este insert.
 *
 * `position` sale de `max(position)+1` de la temporada, escrito EXPLÍCITO —
 * mismo contrato que `createSeason` honra desde S13, ahora respaldado por el
 * índice único `disciplines_season_position` (S19, 0027): si dos llamadas
 * concurrentes leen el mismo máximo, la segunda falla con 23505 en vez de
 * empatar en silencio.
 *
 * ponytail: esa carrera (dos admins agregando a la vez) no se resuelve acá
 * —falla ruidoso, no se previene—, mismo techo aceptado que ya documenta
 * `shift_seeds_up` (0023) para el plantel. Si se vuelve más que anecdótico,
 * la solución es un advisory lock por `season_id`.
 *
 * `entryIds`, por default, es TODO el plantel SQUAD de la temporada — mismo
 * comportamiento que `createSeason` (decisión PR11b, REQ-D1-3: "por default
 * juega todo", sin pantalla de "quién juega qué" en el wizard). Pasar un
 * subconjunto explícito es la capacidad que la UI de Ajustes (slice 2 de
 * esta PR) necesita para el solape PARCIAL (REQ-D1-4): esta función ya la
 * expone, aunque todavía no exista ninguna pantalla que la use.
 */
export async function addDiscipline(
  supabase: Client,
  seasonId: string,
  spec: NewDiscipline,
  entryIds?: string[],
): Promise<DisciplineId> {
  assertValidConfig(spec.config, spec.pairSize ?? 2)

  const { data: maxRow, error: maxError } = await supabase
    .from('disciplines')
    .select('position')
    .eq('season_id', seasonId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxError) throw new EdgeError(`No se pudo leer las disciplinas de la temporada: ${maxError.message}`)

  const { data: discipline, error: disciplineError } = await supabase
    .from('disciplines')
    .insert({
      season_id: seasonId,
      kind: spec.kind ?? 'PADEL',
      config: spec.config as unknown as Json,
      position: (maxRow?.position ?? -1) + 1,
      pair_size: spec.pairSize ?? 2,
      allows_draw: spec.allowsDraw ?? false,
      // Decisión #4029, parte 1, cuando `spec.hasMasters` no llega: de a uno
      // nace SIN Masters -- `generateMastersPairs` (`db/matchday.ts`) rechaza
      // siempre una fecha MASTERS con `pair_size=1`, así que ofrecer el check
      // encendido ahí sería ofrecer algo que la app ya rechaza. De a dos
      // sigue naciendo en `true`, el default de siempre
      // (`0015_disciplines.sql:21`). `spec.hasMasters` manda cuando el
      // caller lo especifica.
      has_masters: spec.hasMasters ?? (spec.pairSize ?? 2) !== 1,
      // `formato_default` sólo se manda si el spec lo trae -- mismo criterio
      // que `createSeason` (`db/season.ts`): sin esto, la fila nace con el
      // default de columna (`ROUND_ROBIN`, 0074).
      ...(spec.formatoDefault === undefined
        ? {}
        : { formato_default: spec.formatoDefault as unknown as Json }),
    })
    .select('id')
    .single()
  if (disciplineError !== null) {
    // Mismo patrón que createMatchday (matchday.ts:237) —
    // traducir los códigos conocidos en vez de dejar pasar el mensaje crudo de Postgres.
    if (disciplineError.code === '23505') {
      throw new EdgeError('Alguien acaba de agregar otra disciplina. Probá de nuevo.')
    }
    if (disciplineError.code === '42501') {
      throw new EdgeError('Sólo quien organiza la temporada puede agregar una disciplina.')
    }
    throw new EdgeError(`No se pudo crear la disciplina: ${disciplineError.message}`)
  }
  if (discipline === null) throw new EdgeError('No se pudo crear la disciplina.')
  const disciplineId = discipline.id as DisciplineId

  // `created_at, id` y no `seed_position` (C37): es sólo el orden de ENTRADA
  // —el de salida lo pone el `rank` de la primaria, más abajo— pero tiene que
  // ser determinístico igual, porque es el desempate de quien no juega la
  // primaria y no tiene orden que copiar.
  let seatQuery = supabase
    .from('entries')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'SQUAD')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (entryIds !== undefined) seatQuery = seatQuery.in('id', entryIds)
  const { data: seats, error: seatsReadError } = await seatQuery
  if (seatsReadError) throw new EdgeError(`No se pudo leer el plantel: ${seatsReadError.message}`)

  // Misma guarda que createSeason (season.ts:240)
  // — sin esto, la config podía describir un plantel que no era el sembrado.
  const seatCount = seats?.length ?? 0
  if (seatCount !== spec.config.squadSize) {
    await supabase.from('disciplines').delete().eq('id', disciplineId)
    throw new EdgeError(
      `El plantel tiene ${seatCount} nombres y la configuración de ${spec.kind ?? 'PADEL'} dice ${spec.config.squadSize}.`,
    )
  }

  if (seats !== null && seats.length > 0) {
    // Decisión #4044: la disciplina NUEVA arranca con el orden de la PRIMARIA
    // (el admin la reordena después si quiere). Salía de
    // `entries.seed_position`, que el contract relaja a `null` para el SQUAD
    // — y `discipline_entries.seed_position` es `not null check (>= 0)`, así
    // que eso no degradaba REQ-D1-2: lo rompía entero.
    //
    // Se numera 0,1,2… en vez de copiar el número de la primaria: con un
    // `entryIds` parcial los de la primaria vienen con huecos, y esta
    // disciplina no tiene por qué heredarlos. Quien no juega la primaria no
    // tiene orden que copiar y va al final, mismo criterio que
    // `seasonSeedOrder` (`db/read.ts`) y que `season_invite` (0026).
    const primaryId = await defaultDisciplineId(supabase, seasonId)
    const rank = new Map(
      (primaryId === null ? [] : await squadSeedOrder(supabase, primaryId)).map((entryId, index) => [entryId, index]),
    )
    const ordered = [...seats].sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )
    const { error: seatsError } = await supabase.from('discipline_entries').insert(
      ordered.map((seat, index) => ({
        discipline_id: disciplineId,
        entry_id: seat.id,
        season_id: seasonId,
        seed_position: index,
      })),
    )
    if (seatsError) {
      await supabase.from('disciplines').delete().eq('id', disciplineId)
      throw new EdgeError(`No se pudo asignar el plantel a la nueva disciplina: ${seatsError.message}`)
    }
  }

  return disciplineId
}
