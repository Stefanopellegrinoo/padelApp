import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fichaLine, fichaSeed, type Modality, type SportId } from '@/core'
import { rulesFromSeed } from './personalizar-reglas-state'
import { modalityHint, offeredModalities, primeraFechaKey, type PrimeraFecha } from './tarjeta-state'
import { TarjetaDeporte } from './tarjeta'

type Props = ComponentProps<typeof TarjetaDeporte>
type Option = Props['primeraFechaOptions'][number]

const POR_NIVEL: Option = { value: 'NIVEL', label: 'Por nivel', sub: 'vos los ordenás' }
const AL_AZAR: Option = { value: 'SORTEO', label: 'Al azar', sub: 'sortea la app' }
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

describe('modalityHint', () => {
  it('cada modalidad en una línea, sin jerga', () => {
    expect(modalityHint('INDIVIDUAL')).toBe('Cada uno juega por su cuenta.')
    expect(modalityHint('FIJAS')).toBe('Siempre con el mismo compañero.')
    expect(modalityHint('ROTAN')).toBe('Cada fecha se cambia de compañero.')
  })
})

describe('primeraFechaKey', () => {
  it('es la misma clave para el mismo valor y distinta para cada "igual que"', () => {
    const values: PrimeraFecha[] = ['NIVEL', 'SORTEO', { igualQue: 'PADEL' }, { igualQue: 'FIFA' }]
    expect(values.map(primeraFechaKey)).toEqual(['NIVEL', 'SORTEO', 'IGUAL:PADEL', 'IGUAL:FIFA'])
  })
})

describe('TarjetaDeporte', () => {
  it('arriba van el nombre del deporte y la pastilla con el plantel, en el color del deporte', () => {
    const html = card('PADEL', 6, 'ROTAN')
    expect(html).toMatch(/<h3[^>]*>Pádel<\/h3>/)
    expect(html).toMatch(/^<section[^>]*data-deporte="PADEL"/)
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

  it('las elecciones son bloques grandes: 44px o más, y la letra no se achica de 14', () => {
    const html = card('PING_PONG', 6, 'INDIVIDUAL')
    const tag = html.match(/<button[^>]*>Individual<\/button>/)?.[0] ?? ''
    expect(Number(/min-h-\[(\d+)px\]/.exec(tag)?.[1])).toBeGreaterThanOrEqual(44)
    expect(Number(/text-\[(\d+)px\]/.exec(tag)?.[1])).toBeGreaterThanOrEqual(14)
    expect(tag).toMatch(/font-(bold|extrabold)/)
  })

  it('la modalidad elegida se explica en una línea debajo de los botones', () => {
    expect(card('PADEL', 6, 'ROTAN')).toContain(modalityHint('ROTAN'))
    expect(card('PADEL', 6, 'FIJAS')).toContain(modalityHint('FIJAS'))
    expect(card('PADEL', 6, 'FIJAS')).not.toContain(modalityHint('ROTAN'))
  })

  it('cada elección es un grupo con su título', () => {
    const html = card('PADEL', 6, 'ROTAN')
    const groups = [...html.matchAll(/<div role="group" aria-labelledby="([^"]+)"/g)].map((m) => m[1])
    expect(groups).toHaveLength(2)
    for (const id of groups) expect(html).toContain(`id="${id}"`)
  })

  it('con onModality null no hay botones de modalidad y se lee como texto', () => {
    const html = card('PADEL', 6, 'ROTAN', { onModality: null })
    expect(html).toMatch(/>Parejas que rotan</)
    expect(html).toContain('Se elige al crear el torneo')
    expect(html).not.toContain(' · ')
    expect(html).not.toContain('Parejas fijas')
    expect(pressed(html)).toEqual(['Por nivelvos los ordenás'])
  })

  it('primera fecha: la pregunta, sus botones con subtítulo, el marcado y qué pasa después', () => {
    const html = card('PADEL', 6, 'ROTAN')
    expect(html).toContain('¿Cómo se arma la primera fecha?')
    expect(html).toContain('Por nivel<span')
    expect(html).toContain('vos los ordenás')
    expect(html).toContain('Al azar<span')
    expect(html).toContain('sortea la app')
    expect(html).toContain('Después, manda la tabla.')
    expect(pressed(html)).toEqual(['Parejas que rotan', 'Por nivelvos los ordenás'])
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

  /** El grupo de botones de "Primera fecha", recortado del HTML por su `aria-labelledby`. */
  const grupoPrimeraFecha = (html: string) => {
    const id = /<p id="([^"]+)"[^>]*>¿Cómo se arma la primera fecha\?<\/p>/.exec(html)?.[1]
    return new RegExp(`<div role="group" aria-labelledby="${id}" class="([^"]*)"`).exec(html)?.[1] ?? ''
  }

  it('con cuatro opciones de primera fecha (tres deportes) van en dos columnas: a 390px no entran en una fila', () => {
    const IGUAL_QUE_FIFA: Option = { value: { igualQue: 'FIFA' }, label: 'Igual que FIFA', sub: null }
    const html = card('PING_PONG', 6, 'INDIVIDUAL', { primeraFechaOptions: [POR_NIVEL, AL_AZAR, IGUAL_QUE_PADEL, IGUAL_QUE_FIFA] })
    expect(grupoPrimeraFecha(html).split(' ')).toEqual(expect.arrayContaining(['grid', 'grid-cols-2']))
  })

  it('con tres o menos siguen en una fila, como siempre', () => {
    for (const options of [[POR_NIVEL, AL_AZAR], [POR_NIVEL, AL_AZAR, IGUAL_QUE_PADEL]]) {
      const clase = grupoPrimeraFecha(card('PING_PONG', 6, 'INDIVIDUAL', { primeraFechaOptions: options }))
      expect(clase).toBe('flex gap-2')
    }
  })

  it('la ficha va como datos, uno por renglón de la lista: lo mismo que arma fichaLine, sin "·"', () => {
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
    const html = card('PADEL', 6, 'ROTAN')
    for (const dato of line.split(' · ')) expect(html).toMatch(new RegExp(`<li[^>]*>${dato}</li>`))
    expect(html).not.toContain(' · ')
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
    // Color de link, el del deporte de la tarjeta (azul en pádel, verde en FIFA).
    expect(tag).toContain('text-sport')
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
    expect(html).toContain('Se elige al crear el torneo')
    expect(html).toMatch(/<li[^>]*>1 set a 4 games<\/li>/)
    expect(html).toMatch(/<li[^>]*>10 fechas<\/li>/)
  })
})

describe('bowling (S4)', () => {
  it('no pregunta cómo se arma la primera fecha: no hay nada que armar', () => {
    const html = card('BOWLING', 4, 'INDIVIDUAL')
    expect(html).toContain('Bowling')
    expect(html).not.toContain('¿Cómo se arma la primera fecha?')
    expect(html).not.toContain('Por nivel')
    expect(html).toContain('Por pinos')
  })

  it('los demás deportes la siguen preguntando', () => {
    expect(card('FIFA', 4, 'INDIVIDUAL')).toContain('¿Cómo se arma la primera fecha?')
  })
})
