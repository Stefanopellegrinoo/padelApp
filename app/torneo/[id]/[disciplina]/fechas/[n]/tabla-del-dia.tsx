/**
 * La tabla del día, aparte de la pantalla para que se pueda renderizar en la
 * suite: `page.tsx` es un server component `async` que abre el cliente de
 * Supabase al montarse. Mismo precedente de extracción que `PasoFormato` y
 * `PanelGoles`, y que `tabla-congelada.ts` / `tabla-desempate.ts` en esta
 * misma carpeta.
 *
 * **Este módulo NO decide el orden ni el reparto.** Recibe las filas ya
 * ordenadas por `computeStandings` (o congeladas por `frozenTableRows`) y los
 * puntos ya resueltos. Acá sólo se dibuja.
 *
 * PR20 rebanada B: la columna `PE` aparece SÓLO donde el empate es un
 * resultado legal. Con los empates pagando, dos lados con el mismo `PG` quedan
 * uno arriba del otro y el de arriba puede tener PEOR diferencia — medido en
 * Chromium, `J1 & J8` (PG 1, Dif −3) arriba de `J3 & J6` (PG 1, Dif −2)—, y
 * sin esta columna la tabla ordena bien y no puede explicarse. `Pts` no
 * alcanza: es el puntaje del CAMPEONATO, que se reparte al cerrar, y durante
 * la fecha dice un guión.
 *
 * En el pádel la columna no se dibuja, y eso es una decisión de producto de
 * Stefano, no una optimización: sería una fila de ceros —el empate es
 * IMPOSIBLE sin `allows_draw`, lo prohíbe `match_sets_no_draw` (0034)— y a
 * 360 px los nombres ya truncan (S73), así que no hay 34 px para regalar.
 */

/** Una fila ya resuelta: nada acá se calcula, todo llega decidido. */
export interface FilaDelDia {
  /** Identidad del lado para React. La arma quien sabe de lados, no esta tabla. */
  key: string
  nombre: string
  esInvitado: boolean
  won: number
  drawn: number
  gamesDiff: number
  /** Ya formateados: un guión mientras la fecha está abierta. */
  pts: string
}

/**
 * Las dos grillas van ESCRITAS ENTERAS y no armadas por interpolación, que es
 * lo único que Tailwind sabe escanear: `grid-cols-[1fr_${n}]` no emite nada.
 * Misma trampa que S72 verificó para `focus-visible:ring-accent-link`.
 */
const GRID_SIN_EMPATES = 'grid-cols-[1fr_34px_44px_44px]'
const GRID_CON_EMPATES = 'grid-cols-[1fr_34px_34px_44px_44px]'

export function TablaDelDia({
  filas,
  tituloLado,
  muestraEmpates,
}: {
  filas: readonly FilaDelDia[]
  /** "Pareja" o "Jugador", según la disciplina se juegue de a dos o de a uno. */
  tituloLado: string
  muestraEmpates: boolean
}) {
  const grid = muestraEmpates ? GRID_CON_EMPATES : GRID_SIN_EMPATES
  return (
    <div className="overflow-hidden rounded-[14px] border border-line">
      <div
        className={`grid ${grid} gap-2 bg-chip px-3 py-2 text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted`}
      >
        <span>{tituloLado}</span>
        <span className="text-right">PG</span>
        {muestraEmpates && <span className="text-right">PE</span>}
        <span className="text-right">Dif</span>
        <span className="text-right">Pts</span>
      </div>
      {filas.map((fila, index) => (
        <div
          key={fila.key}
          className={`grid ${grid} items-center gap-2 px-3 py-2 text-[13.5px] ${
            index > 0 ? 'border-t border-line' : ''
          }`}
        >
          <span className="flex items-center gap-1.5 font-bold">
            {fila.nombre}
            {fila.esInvitado && (
              <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] font-extrabold text-muted">
                Invitado
              </span>
            )}
          </span>
          <span className="text-right font-bold text-muted">{fila.won}</span>
          {muestraEmpates && (
            <span className="text-right font-bold text-muted">{fila.drawn}</span>
          )}
          <span className="text-right font-bold text-muted">
            {fila.gamesDiff >= 0 ? '+' : ''}
            {fila.gamesDiff}
          </span>
          <span className="text-right text-[17px] font-extrabold">{fila.pts}</span>
        </div>
      ))}
    </div>
  )
}
