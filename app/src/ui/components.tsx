import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { SETPOINT_MAX, SETPOINT_MIN } from '../core/protocol'
import { DAY_LABELS, DAY_NAMES } from '../core/schedule'
import accountCreated from '../assets/illustrations/account-created.svg?raw'
import connectionError from '../assets/illustrations/connection-error.svg?raw'
import scheduleEmpty from '../assets/illustrations/schedule-empty.svg?raw'
import welcome from '../assets/illustrations/welcome.svg?raw'
import zoneOff from '../assets/illustrations/zone-off.svg?raw'
import { useAppState, useController } from './app-context'
import { pushBack } from './back'

const ILLUSTRATIONS = { welcome, scheduleEmpty, connectionError, accountCreated, zoneOff }

export function Illustration({ name }: { name: keyof typeof ILLUSTRATIONS }) {
  // Local, trusted SVG files bundled with the app.
  return <div className="illustration" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ILLUSTRATIONS[name] }} />
}

export const formatTemp = (c: number | undefined, digits = 1): string =>
  c === undefined ? '—' : `${c.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: 1 })}°`

export function tempTone(c: number): 'warm' | 'mild' | 'coolish' {
  if (c >= 21) return 'warm'
  if (c <= 18.5) return 'coolish'
  return 'mild'
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    />
  )
}

export function TempStepper(props: {
  value: number
  onChange: (v: number) => void
  label: string
  big?: boolean
  min?: number
  max?: number
  disabled?: boolean
}) {
  const min = props.min ?? SETPOINT_MIN
  const max = props.max ?? SETPOINT_MAX
  const set = (v: number) => props.onChange(Math.min(max, Math.max(min, Math.round(v * 2) / 2)))
  return (
    <div className={props.big ? 'dial' : 'setpoint'} role="group" aria-label={props.label}>
      <button
        type="button"
        className={`icon-btn ${props.big ? 'big' : ''}`}
        aria-label={`Bajar medio grado. ${props.label}`}
        disabled={props.disabled || props.value <= min}
        onClick={() => set(props.value - 0.5)}
      >
        −
      </button>
      <div className={props.big ? 'value' : 'target'} aria-live={props.big ? 'polite' : undefined}>
        {props.big ? formatTemp(props.value) : <span className="value">{formatTemp(props.value)}</span>}
      </div>
      <button
        type="button"
        className={`icon-btn ${props.big ? 'big' : ''}`}
        aria-label={`Subir medio grado. ${props.label}`}
        disabled={props.disabled || props.value >= max}
        onClick={() => set(props.value + 0.5)}
      >
        +
      </button>
    </div>
  )
}

export function Sheet(props: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; dirty?: boolean }) {
  const [asking, setAsking] = useState(false)
  // Closing with unsaved changes asks first instead of silently discarding them.
  const attempt = useRef(() => {})
  attempt.current = () => (props.dirty && !asking ? setAsking(true) : props.onClose())
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && attempt.current()
    window.addEventListener('keydown', onKey)
    const pop = pushBack(() => attempt.current())
    return () => {
      window.removeEventListener('keydown', onKey)
      pop()
    }
  }, [])
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && attempt.current()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{props.title}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={() => attempt.current()}>
            ×
          </button>
        </div>
        {asking && (
          <div className="notice warn stack sheet-ask" style={{ display: 'flex', flexDirection: 'column' }} role="alert">
            <span>Tienes cambios sin guardar. ¿Quieres descartarlos?</span>
            <div className="row">
              <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setAsking(false)}>
                Seguir editando
              </button>
              <button type="button" className="btn btn-danger" style={{ flex: 1 }} onClick={props.onClose}>
                Descartar
              </button>
            </div>
          </div>
        )}
        {props.children}
        {props.actions}
      </section>
    </div>
  )
}

export function DayPicker(props: { days: boolean[]; onChange: (d: boolean[]) => void }) {
  const preset = (d: boolean[]) => props.onChange(d)
  const weekdays = [true, true, true, true, true, false, false]
  const weekend = [false, false, false, false, false, true, true]
  const same = (a: boolean[]) => a.every((v, i) => v === props.days[i])
  return (
    <div className="stack">
      <div className="days">
        {DAY_LABELS.map((l, i) => (
          <button
            key={l}
            type="button"
            aria-pressed={props.days[i]}
            aria-label={DAY_NAMES[i]}
            onClick={() => props.onChange(props.days.map((v, j) => (j === i ? !v : v)))}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={same(weekdays)} onClick={() => preset(weekdays)}>
          Lunes a viernes
        </button>
        <button type="button" className="chip" aria-pressed={same(weekend)} onClick={() => preset(weekend)}>
          Fin de semana
        </button>
        <button type="button" className="chip" aria-pressed={same(Array(7).fill(true))} onClick={() => preset(Array(7).fill(true))}>
          Todos
        </button>
      </div>
    </div>
  )
}

export function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: string
  error?: string
  autoComplete?: string
  inputMode?: 'text' | 'numeric'
  placeholder?: string
  autoFocus?: boolean
}) {
  const id = useId()
  const [show, setShow] = useState(false)
  const isPassword = props.type === 'password'
  const input = (
    <input
      id={id}
      type={isPassword && show ? 'text' : (props.type ?? 'text')}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      autoComplete={props.autoComplete}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      inputMode={props.inputMode}
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      aria-invalid={props.error ? true : undefined}
      aria-describedby={`${id}-d`}
    />
  )
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {isPassword ? (
        <div className="password-wrap">
          {input}
          <button type="button" className="btn-link" onClick={() => setShow(!show)}>
            {show ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      ) : (
        input
      )}
      <div id={`${id}-d`}>
        {props.error ? <div className="error">{props.error}</div> : props.hint && <div className="hint">{props.hint}</div>}
      </div>
    </div>
  )
}

export function Toasts() {
  const { toasts } = useAppState()
  const c = useController()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast ${t.kind}`} onClick={() => c.dismissToast(t.id)}>
          <span>{t.text}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  )
}

export function relativeTime(ts: number | undefined, now = Date.now()): string {
  if (!ts) return 'sin datos'
  const s = Math.round((now - ts) / 1000)
  if (s < 60) return 'ahora mismo'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

export function formatIn(minutes: number): string {
  if (minutes < 60) return `en ${minutes} min`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `en ${h} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  const d = Math.floor(h / 24)
  return d === 1 ? 'mañana' : `en ${d} días`
}

export function Icon({ name }: { name: 'home' | 'calendar' | 'settings' | 'plus' | 'flame' | 'snow' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <path d="M3 11 12 4l9 7" />
          <path d="M5 10v10h14V10" />
        </svg>
      )
    case 'calendar':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      )
    case 'plus':
      return (
        <svg viewBox="0 0 24 24" {...common} width="22" height="22" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'flame':
      return (
        <svg viewBox="0 0 24 24" {...common} width="18" height="18" aria-hidden="true">
          <path d="M12 3c3 4 6 6.5 6 10.5a6 6 0 0 1-12 0C6 10 9 8 12 3Z" />
        </svg>
      )
    case 'snow':
      return (
        <svg viewBox="0 0 24 24" {...common} width="18" height="18" aria-hidden="true">
          <path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5" />
        </svg>
      )
  }
}
