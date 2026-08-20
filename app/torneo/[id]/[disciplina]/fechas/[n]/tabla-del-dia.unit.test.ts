import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TablaDelDia, type FilaDelDia } from './tabla-del-dia'

/**
 * La tabla del día, RENDERIZADA.
 *
 * PR20 rebanada B dejó a la tabla ordenando bien y sin poder explicarse: con
 * los empates pagando, dos lados con el MISMO `PG` quedan uno arriba del otro
 * y el de arriba puede tener PEOR diferencia. Medido en Chromium:
 *
 *   PAREJA          PG  DIF  PTS
 *   J1 & J8          1   -3   —      <- arriba
 *   J3 & J6          1   -2   —      <- abajo, con mejor diferencia
 *
 * La decisión de Stefano: la columna `PE` aparece SÓLO donde el empate es un
 * resultado legal. El pádel no gana una columna de ceros y su fila no se mueve
 * un pixel — a 360 px los nombres ya truncan (S73) y no hay 34 px para regalar.
 */

const FILAS: FilaDelDia[] = [
  { key: 'a', nombre: 'Jugador 2 & Jugador 7', esInvitado: false, won: 2, drawn: 0, gamesDiff: 5, pts: '—' },
  { key: 'b', nombre: 'Jugador 1 & Jugador 8', esInvitado: false, won: 1, drawn: 1, gamesDiff: -3, pts: '—' },
  { key: 'c', nombre: 'Jugador 3 & Jugador 6', esInvitado: false, won: 1, drawn: 0, gamesDiff: -2, pts: '—' },
]

function html(muestraEmpates: boolean, filas: FilaDelDia[] = FILAS): string {
  return renderToStaticMarkup(
    createElement(TablaDelDia, { filas, tituloLado: 'Pareja', muestraEmpates }),
  )
}

/** El texto de las celdas, fila por fila, sin markup. */
function celdas(markup: string): string {
  return markup.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
}

describe('la tabla del día con empates', () => {
  it('pone la columna PE en el encabezado', () => {
    expect(html(true)).toContain('>PE<')
  })

  it('y dice cuántos empató cada lado', () => {
    // J1 & J8: ganó 1, empató 1. Sin esta columna su puesto no se explica.
    expect(celdas(html(true))).toContain('|Jugador 1 & Jugador 8|1|1|-3|—|')
    expect(celdas(html(true))).toContain('|Jugador 3 & Jugador 6|1|0|-2|—|')
  })

  it('ensancha la grilla a cinco columnas, encabezado y filas', () => {
    const conEmpates = html(true)
    expect(conEmpates).toContain('grid-cols-[1fr_34px_34px_44px_44px]')
    expect(conEmpates).not.toContain('grid-cols-[1fr_34px_44px_44px]')
  })
})

describe('la tabla del día SIN empates: el pádel no se entera', () => {
  it('no dibuja la columna PE', () => {
    expect(html(false)).not.toContain('>PE<')
  })

  it('deja la grilla de cuatro columnas EXACTAMENTE como estaba', () => {
    const sinEmpates = html(false)
    expect(sinEmpates).toContain('grid-cols-[1fr_34px_44px_44px]')
    expect(sinEmpates).not.toContain('grid-cols-[1fr_34px_34px_44px_44px]')
  })

  it('y las celdas siguen siendo cuatro por fila', () => {
    expect(celdas(html(false))).toContain('|Jugador 1 & Jugador 8|1|-3|—|')
  })

  // El empate es INALCANZABLE sin `allows_draw` —lo prohíbe `match_sets_no_draw`
  // (0034)— pero el prop no lo sabe. Si alguna vez llega un `drawn` con la
  // columna apagada, el número no se dibuja en ningún lado: no se cuela en la
  // celda de al lado ni desalinea la fila.
  it('un drawn que llegue con la columna apagada no se filtra a otra celda', () => {
    const raro = [{ ...FILAS[1]!, drawn: 7 }]
    expect(celdas(html(false, raro))).toContain('|Jugador 1 & Jugador 8|1|-3|—|')
    expect(html(false, raro)).not.toContain('>7<')
  })
})

describe('lo que la tabla dibuja igual en las dos', () => {
  it('marca al invitado', () => {
    const conInvitado = [{ ...FILAS[0]!, esInvitado: true }]
    expect(html(false, conInvitado)).toContain('Invitado')
    expect(html(true, conInvitado)).toContain('Invitado')
  })

  it('el signo + sólo va en la diferencia positiva', () => {
    expect(celdas(html(false))).toContain('|+5|')
    expect(celdas(html(false))).toContain('|-3|')
  })

  it('el encabezado nombra al lado como se lo llame', () => {
    const solo = renderToStaticMarkup(
      createElement(TablaDelDia, { filas: FILAS, tituloLado: 'Jugador', muestraEmpates: false }),
    )
    expect(solo).toContain('>Jugador<')
  })
})
