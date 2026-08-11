'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS, type SeasonConfig } from '@/core'
import { createTournament } from './actions'
import {
  STEPPERS,
  configFor,
  filledCount,
  formatErrors,
  resizeConfig,
  squadWarning,
  summaryOf,
} from './wizard-state'

const TITLES = ['Nombre', 'El plantel', 'Orden inicial', 'Formato', 'Listo']
const HELP = [
  'Como lo llaman en el grupo. Se puede cambiar después.',
  'Tipeá los nombres del grupo, de 8 a 12. Después compartís un link y cada uno elige el suyo. No hace falta que vayan todos a todas las fechas.',
  'Ordenalos del mejor al peor. Es el criterio que corta los empates hasta que haya fechas jugadas, y de ahí salen las primeras parejas.',
  'Todos tienen un valor que ya funciona. Si no te importa, seguí de largo.',
  '',
]

function Progress({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-accent' : 'bg-line'}`}
        />
      ))}
    </div>
  )
}

function Aviso({ children }: { children: string }) {
  return (
    <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
      {children}
    </p>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  const button = 'h-[34px] w-[34px] shrink-0 rounded-[9px] bg-chip text-[16px] font-extrabold disabled:opacity-40'
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" className={button} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-9 text-center text-[20px] font-extrabold tracking-[-.02em]">{value}</span>
      <button type="button" className={button} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}

/**
 * Crear torneo — §6 del handoff. Los cinco pasos en un solo componente y un
 * solo submit: es un formulario que se usa una vez por año, y partirlo en cinco
 * rutas con estado compartido es pagar routing por nada.
 */
export function Wizard() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [names, setNames] = useState<string[]>(() => Array(MIN_PLAYERS).fill(''))
  const [config, setConfig] = useState<SeasonConfig>(() => configFor(MIN_PLAYERS))
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ seasonId: string; inviteToken: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const filled = filledCount(names)
  const warning = squadWarning(names)
  const errors = formatErrors(config)

  const setSquadSize = (next: string[]) => {
    setNames(next)
    setConfig((current) => resizeConfig(current, filledCount(next)))
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= names.length) return
    const next = [...names]
    const moved = next[from]!
    next[from] = next[to]!
    next[to] = moved
    setNames(next)
  }

  const blocked =
    (step === 0 && name.trim().length === 0) ||
    (step === 1 && warning !== null) ||
    (step === 3 && errors.length > 0)

  const inviteUrl =
    created === null
      ? ''
      : `${typeof window === 'undefined' ? '' : window.location.origin}/unirse/${created.inviteToken}`

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await createTournament({
        name,
        squadNames: names.filter((seat) => seat.trim().length > 0),
        config: { ...config, squadSize: filled },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCreated({ seasonId: result.seasonId, inviteToken: result.inviteToken })
      setStep(4)
    })
  }

  const advance = () => {
    if (step === 3) {
      submit()
      return
    }
    setStep(step + 1)
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-4 bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex items-center justify-between">
        {step === 0 ? (
          <Link href="/torneos" className="rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold">
            ← Volver
          </Link>
        ) : step < 4 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold"
          >
            ← Volver
          </button>
        ) : (
          <span />
        )}
      </div>

      <Progress step={step} />

      <header className="flex flex-col gap-[3px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Paso {step + 1} de 5
        </p>
        <h1 className="text-[30px] font-extrabold tracking-[-.03em]">{TITLES[step]}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-3">
        {step === 0 && (
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Los Jueves 2026"
            className="rounded-field border-[1.5px] border-accent bg-surface p-[15px] text-[17px] font-[750] outline-none placeholder:font-medium placeholder:text-muted"
          />
        )}

        {step === 1 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                El plantel
              </p>
              <p className="text-[11.5px] font-extrabold text-muted">{filled} jugadores</p>
            </div>
            {names.map((seat, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                <input
                  value={seat}
                  onChange={(event) => {
                    const next = [...names]
                    next[index] = event.target.value
                    setSquadSize(next)
                  }}
                  placeholder="Nombre"
                  className={`min-w-0 flex-1 rounded-field border-[1.5px] bg-surface p-[15px] text-[15.5px] font-[700] outline-none placeholder:font-medium placeholder:text-muted ${
                    seat.trim().length === 0 ? 'border-accent' : 'border-line'
                  }`}
                />
                {names.length > MIN_PLAYERS && (
                  <button
                    type="button"
                    aria-label={`Sacar al jugador ${index + 1}`}
                    onClick={() => setSquadSize(names.filter((_, at) => at !== index))}
                    className="h-7 w-7 shrink-0 rounded-full bg-chip text-[13px] font-extrabold text-muted"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {names.length < MAX_PLAYERS && (
              <button
                type="button"
                onClick={() => setSquadSize([...names, ''])}
                className="rounded-field border-[1.5px] border-line p-[13px] text-[14px] font-[750] text-muted"
              >
                + Agregar jugador
              </button>
            )}
            {warning !== null && <Aviso>{warning}</Aviso>}
          </>
        )}

        {step === 2 && (
          <div className="overflow-hidden rounded-[14px] border border-line">
            {names.map((seat, index) => (
              <div
                key={index}
                className={`flex items-center gap-2 px-3 py-2 ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <span className="text-[13px] text-muted">⠿</span>
                <span className="w-5 shrink-0 text-[13px] font-extrabold text-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{seat}</span>
                <button
                  type="button"
                  aria-label={`Subir a ${seat}`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  className="h-[34px] w-[34px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Bajar a ${seat}`}
                  disabled={index === names.length - 1}
                  onClick={() => move(index, index + 1)}
                  className="h-[34px] w-[34px] shrink-0 rounded-[9px] bg-chip font-extrabold disabled:opacity-40"
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <>
            <p className="text-[13.5px] font-[550] leading-[1.5] text-muted">
              Son los puntos de cada posición de la fecha. Si una fecha la juegan menos parejas, se
              usan los primeros de la lista — ganar siempre suma {config.points[0] ?? 0}.
            </p>
            {/* 🔁 El handoff dibujaba los puntos en 4 columnas y no escala: un
                plantel de 12 necesita 6 valores y no entran a lo ancho. Filas. */}
            <div className="overflow-hidden rounded-[14px] border border-line">
              {config.points.map((value, index) => (
                <div
                  key={index}
                  className={`flex h-[56px] items-center justify-between gap-2 px-3 ${index > 0 ? 'border-t border-line' : ''}`}
                >
                  <span className="w-7 shrink-0 text-[13px] font-extrabold text-muted">
                    {index + 1}°
                  </span>
                  <Stepper
                    value={value}
                    min={1}
                    max={99}
                    onChange={(next) => {
                      const points = [...config.points]
                      points[index] = next
                      setConfig({ ...config, points })
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-[14px] border border-line">
              {STEPPERS.map((stepper, index) => (
                <div
                  key={stepper.key}
                  className={`flex min-h-[56px] items-center justify-between gap-2 px-3 py-2 ${index > 0 ? 'border-t border-line' : ''}`}
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold">{stepper.label}</p>
                    <p className="text-pretty text-[11.5px] font-semibold text-muted">
                      {stepper.hint}
                    </p>
                  </div>
                  <Stepper
                    value={
                      stepper.key === 'setsToWin' || stepper.key === 'gamesPerSet'
                        ? config.matchFormat[stepper.key]
                        : config[stepper.key]
                    }
                    min={stepper.min}
                    max={stepper.max}
                    onChange={(next) =>
                      setConfig(
                        stepper.key === 'setsToWin' || stepper.key === 'gamesPerSet'
                          ? { ...config, matchFormat: { ...config.matchFormat, [stepper.key]: next } }
                          : { ...config, [stepper.key]: next },
                      )
                    }
                  />
                </div>
              ))}
            </div>

            {errors.map((message) => (
              <Aviso key={message}>{message}</Aviso>
            ))}
          </>
        )}

        {step === 4 && created !== null && (
          <>
            <div className="rounded-card bg-accent p-4 text-accent-text">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] opacity-75">
                Link de invitación
              </p>
              <p className="mt-1 break-all text-[13.5px] font-bold">{inviteUrl}</p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl)
                  setCopied(true)
                }}
                className="mt-3 w-full rounded-field bg-accent-text p-3 text-[14px] font-extrabold text-accent"
              >
                {copied ? 'Copiado ✓' : 'Copiar link'}
              </button>
              <p className="mt-2 text-[12px] font-semibold opacity-75">
                Pegalo en el grupo. Cada uno elige su nombre de la lista al entrar.
              </p>
            </div>

            <div className="overflow-hidden rounded-[14px] border border-line">
              {summaryOf(name, names, config).map((row, index) => (
                <div
                  key={row.key}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${index > 0 ? 'border-t border-line' : ''}`}
                >
                  <span className="text-[13px] font-semibold text-muted">{row.key}</span>
                  <span className="text-right text-[13.5px] font-[750]">{row.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {HELP[step] !== '' && (
          <p className="text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted">
            {HELP[step]}
          </p>
        )}

        {error !== null && <Aviso>{error}</Aviso>}
      </div>

      <div className="flex gap-2">
        {step === 3 && (
          <button
            type="button"
            onClick={() => setConfig(configFor(filled))}
            className="rounded-field border-[1.5px] border-line px-4 py-4 text-[14px] font-extrabold"
          >
            Usar los defaults
          </button>
        )}
        {step === 4 && created !== null ? (
          <button
            type="button"
            onClick={() => router.push(`/torneo/${created.seasonId}`)}
            className="flex-1 rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text"
          >
            Ir al torneo
          </button>
        ) : (
          <button
            type="button"
            disabled={blocked || pending}
            onClick={advance}
            className={`flex-1 rounded-field p-4 text-center text-[15px] font-extrabold ${
              blocked || pending ? 'bg-chip text-muted' : 'bg-accent text-accent-text'
            }`}
          >
            Continuar
          </button>
        )}
      </div>
    </main>
  )
}
