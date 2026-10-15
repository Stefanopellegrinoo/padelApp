import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fichaLine, fichaSeed, type Modality, type SportId } from '@/core'
import { rulesFromSeed } from './personalizar-reglas-state'
import { offeredModalities, primeraFechaKey, type PrimeraFecha } from './tarjeta-state'
import { TarjetaDeporte } from './tarjeta'

type Props = ComponentProps<typeof TarjetaDeporte>
type Option = Props['primeraFechaOptions'][number]

const POR_NIVEL: Option = { value: 'NIVEL', label: 'Por nivel', sub: 'las ordenás vos' }
const AL_AZAR: Option = { value: 'SORTEO', label: 'Al azar', sub: 'sorteo' }
const IGUAL_QUE_PADEL: Option = { value: { igualQue: 'PADEL' }, label: 'Igual que Pádel', sub: null }

function card(kind: SportId, squad: number, modality: Modality, override: Partial<Props> = {}): string {
  const seed = fichaSeed(kind, squad, modality)
  return renderToStaticMarkup(
    createElement(TarjetaDeporte, {
      kind,
      squadSize: squad,
      modality,
      onModality: () => {},
      primeraFecha: seed.config.firstFecha ?? 'SORTEO',
      primeraFechaOptions: [POR_NIVEL, AL_AZAR],
      onPrimeraFecha: () => {},
      rules: rulesFromSeed(seed),
      pairSize: seed.pairSize,
      fixedTeams: seed.fixedTeams,
      warning: null,
      onPersonalizar: () => {},
      ...override,
    }),
  )
}

/** Los textos de los botones que dicen "elegido" (`aria-pressed="true"`), sin etiquetas. */
const pressed = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) => (m[1] ?? '').replace(/<[^>]+>/g, ''))

describe('offeredModalities', () => {
  it('Pádel ofrece fijas y rotan, en el orden de los botones (no en el de la ficha, que pone rotan primero)', () => {
    expect(offeredModalities('PADEL')).toEqual(['FIJAS', 'ROTAN'])
  })

  it('Ping pong ofrece las tres', () => {
    expect(offeredModalities('PING_PONG')).toEqual(['INDIVIDUAL', 'FIJAS', 'ROTAN'])
  })

  it('un deporte sin ficha o fuera del registro no ofrece ninguna', () => {
    expect(offeredModalities('FUTBOL')).toEqual([])
    expect(offeredModalities('RAYUELA')).toEqual([])
  })
})

describe('primeraFechaKey', () => {
  it('es la misma clave para el mismo valor y distinta para cada "igual que"', () => {
    const values: PrimeraFecha[] = ['NIVEL', 'SORTEO', { igualQue: 'PADEL' }, { igualQue: 'FIFA' }]
    expect(values.map(primeraFechaKey)).toEqual(['NIVEL', 'SORTEO', 'IGUAL:PADEL', 'IGUAL:FIFA'])
  })
})

describe('TarjetaDeporte', () => {
  it('arriba van el nombre del deporte y la pastilla con el plantel', () => {
    const html = card('PADEL', 6, 'ROTAN')
    expect(html).toMatch(/<h3[^>]*font-extrabold[^>]*>Pádel<\/h3>/)
    const pill = html.match(/<span[^>]*>6 jugadores<\/span>/)?.[0] ?? ''
    expect(pill).toContain('bg-chip')
    expect(pill).toContain('rounded-full')
  })

  it('Pádel: "Parejas fijas" antes que "Parejas que rotan" y marcada la de la modalidad', () => {
    const html = card('PADEL', 6, 'ROTAN')
    expect(html.indexOf('Parejas fijas')).toBeGreaterThan(-1)
    expect(html.indexOf('Parejas fijas')).toBeLessThan(html.indexOf('Parejas que rotan'))
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Parejas que rotan<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Parejas fijas<\/button>/)
    expect(html).not.toContain('Individual')
  })

  it('Ping pong: las modalidades se llaman como su ficha ("Dobles fijos")', () => {
    const html = card('PING_PONG', 6, 'INDIVIDUAL')
    expect(html).toContain('Dobles fijos')
    expect(html).toContain('Dobles que rotan')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Individual<\/button>/)
  })

  it('los botones son los de /rapido: 44px, y la letra no se achica', () => {
    const html = card('PING_PONG', 6, 'INDIVIDUAL')
    const tag = html.match(/<button[^>]*>Individual<\/button>/)?.[0] ?? ''
    expect(tag).toContain('min-h-[44px]')
    expect(tag).toContain('text-[14px]')
    expect(tag).toContain('font-extrabold')
  })

  it('cada elección es un grupo con su título', () => {
    const html = card('PADEL', 6, 'ROTAN')
    const groups = [...html.matchAll(/<div role="group" aria-labelledby="([^"]+)"/g)].map((m) => m[1])
    expect(groups).toHaveLength(2)
    for (const id of groups) expect(html).toContain(`id="${id}"`)
  })

  it('con onModality null no hay botones de modalidad y se lee como texto', () => {
    const html = card('PADEL', 6, 'ROTAN', { onModality: null })
    expect(html).toContain('Parejas que rotan · se elige al crear el torneo')
    expect(html).not.toContain('Parejas fijas')
    expect(pressed(html)).toEqual(['Por nivellas ordenás vos'])
  })

  it('primera fecha: el rótulo, sus botones con subtítulo y el marcado', () => {
    const html = card('PADEL', 6, 'ROTAN')
    expect(html).toContain('Primera fecha')
    expect(html).toContain('Por nivel<span')
    expect(html).toContain('las ordenás vos')
    expect(html).toContain('Al azar<span')
    expect(html).toContain('sorteo')
    expect(pressed(html)).toEqual(['Parejas que rotan', 'Por nivellas ordenás vos'])
  })

  it('con dos opciones de primera fecha no aparece "Igual que"', () => {
    expect(card('PADEL', 6, 'ROTAN')).not.toContain('Igual que')
  })

  it('con otro deporte aparece "Igual que Pádel", sin subtítulo, y se marca si es la elegida', () => {
    const options = [POR_NIVEL, AL_AZAR, IGUAL_QUE_PADEL]
    const html = card('PING_PONG', 6, 'INDIVIDUAL', { primeraFechaOptions: options, primeraFecha: { igualQue: 'PADEL' } })
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Igual que Pádel<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Al azar<span/)
  })

  it('la ficha va en una línea, la misma que arma fichaLine', () => {
    const seed = fichaSeed('PADEL', 6, 'ROTAN')
    const line = fichaLine({
      kind: 'PADEL',
      pairSize: 2,
      fixedTeams: false,
      hasMasters: true,
      allowsDraw: false,
      formatoDefault: seed.formatoDefault,
      config: seed.config,
    })
    expect(line).toBe('1 set a 4 games · 10 fechas · cuentan las 8 mejores · Masters al final')
    expect(card('PADEL', 6, 'ROTAN')).toMatch(new RegExp(`<p[^>]*text-muted[^>]*>${line}</p>`))
  })

  it('la ficha sigue a las reglas que le pasan, no a las del deporte', () => {
    const seed = fichaSeed('PADEL', 6, 'ROTAN')
    const rules = { ...rulesFromSeed(seed), hasMasters: false }
    expect(card('PADEL', 6, 'ROTAN', { rules })).not.toContain('Masters al final')
  })

  it('"Personalizar reglas ›" es un botón de 44px que nombra el deporte', () => {
    const html = card('PADEL', 6, 'ROTAN')
    const tag = html.match(/<button[^>]*aria-label="Personalizar reglas de Pádel"[^>]*>/)?.[0] ?? ''
    expect(tag).toContain('min-h-[44px]')
    expect(tag).toContain('text-accent-link')
    expect(tag).toContain('font-extrabold')
    expect(html).toContain('Personalizar reglas ›')
  })

  it('el aviso aparece sólo si hay uno', () => {
    expect(card('PADEL', 5, 'FIJAS')).not.toContain('bg-live-bg')
    const html = card('PADEL', 5, 'FIJAS', { warning: 'Con 5 jugadores sobra uno.' })
    expect(html).toMatch(/<p[^>]*bg-live-bg[^>]*>Con 5 jugadores sobra uno\.<\/p>/)
  })

  it('un deporte fuera del registro (una disciplina vieja en Ajustes) no tira: nombre tal cual y modalidad genérica', () => {
    const html = card('PADEL', 6, 'ROTAN', { kind: 'RAYUELA', onModality: null })
    expect(html).toMatch(/<h3[^>]*>RAYUELA<\/h3>/)
    expect(html).toContain('Parejas que rotan · se elige al crear el torneo')
    expect(html).toContain('1 set a 4 games · 10 fechas')
  })
})
