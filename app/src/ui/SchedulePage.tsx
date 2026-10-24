import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ZoneInfo } from '../core/installation'
import {
  DAY_LABELS,
  DAY_NAMES,
  SCHEDULE_SLOTS,
  SMALL_HOURS,
  applyDelete,
  applyEdit,
  compact,
  copyZoneSchedule,
  describeDays,
  formatMinute,
  groupConflicts,
  logicalDays,
  newEventId,
  nextTransition,
  removeCoverage,
  routineEvents,
  scheduledSetpointAt,
  sleepsAfterMidnight,
  weekday,
  whenLabel,
  zoneTransitions,
  type ConflictGroup,
  type EditScope,
  type ScheduleEvent,
} from '../core/schedule'
import { useAppState, useController } from './app-context'
import { AwayCard } from './Away'
import { DayPicker, Icon, Illustration, Sheet, Switch, TempStepper, formatTemp, tempTone } from './components'
import { zoneViews } from './Home'

const ALL_DAYS = () => Array(7).fill(true) as boolean[]
const WEEKDAYS = () => [true, true, true, true, true, false, false]

const fromTime = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function TimeInput(props: { label: string; value: number; onChange: (m: number) => void; note?: string }) {
  return (
    <div className="field">
      <label>
        {props.label}
        <input
          type="time"
          step={300}
          value={formatMinute(props.value)}
          onChange={(e) => e.target.value && props.onChange(fromTime(e.target.value))}
          style={{ fontSize: '1.4rem', fontWeight: 700, width: '100%', marginTop: 6 }}
        />
      </label>
      {props.note && <div className="hint">{props.note}</div>}
    </div>
  )
}

function ZoneChips(props: { zones: ZoneInfo[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="chips" role="group" aria-label="Zonas">
      {props.zones.map((z) => {
        const on = props.value.includes(z.index)
        return (
          <button
            key={z.index}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => props.onChange(on ? props.value.filter((v) => v !== z.index) : [...props.value, z.index].sort((a, b) => a - b))}
          >
            {z.name}
          </button>
        )
      })}
    </div>
  )
}

const joinNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`)

// ---- week view -----------------------------------------------------------------

/** Distinct colours per temperature used in this zone, from cool to warm. */
function palette(temps: number[]): Map<number, string> {
  const sorted = [...new Set(temps)].sort((a, b) => a - b)
  return new Map(
    sorted.map((t, i) => {
      const pct = sorted.length === 1 ? (t >= 20 ? 100 : 0) : Math.round((i / (sorted.length - 1)) * 100)
      return [t, `color-mix(in srgb, var(--heat) ${pct}%, var(--cool))`]
    }),
  )
}

interface Segment {
  from: number
  to: number
  sp: number | undefined
}

function daySegments(transitions: ReturnType<typeof zoneTransitions>, day: number): Segment[] {
  const cuts = [0, ...transitions.filter((t) => t.day === day).map((t) => t.minute), 1440]
  const segs: Segment[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    if (cuts[i + 1] <= cuts[i]) continue
    segs.push({ from: cuts[i], to: cuts[i + 1], sp: scheduledSetpointAt(transitions, day * 1440 + cuts[i]) })
  }
  return segs
}

function WeekView({ events, zone }: { events: ScheduleEvent[]; zone: number }) {
  const transitions = zoneTransitions(events, zone)
  const now = new Date()
  const today = weekday(now)
  const nowMinute = now.getHours() * 60 + now.getMinutes()
  const [open, setOpen] = useState<number | null>(today)
  if (!transitions.length) return null
  const colors = palette(transitions.map((t) => t.setpoint))
  const todaySegs = daySegments(transitions, today)
  const current = todaySegs.find((s) => s.from <= nowMinute && nowMinute < s.to)
  const next = nextTransition(events, zone, now)
  return (
    <div className="card stack" aria-label="Resumen semanal">
      {current?.sp !== undefined && (
        <p>
          <b>Ahora, según el horario: {formatTemp(current.sp)}</b>
          {next && (
            <span className="muted">
              {' '}
              hasta {whenLabel(next.inMinutes, now)} a las {formatMinute(next.minute)}
            </span>
          )}
        </p>
      )}
      <div className="week">
        {DAY_LABELS.map((label, day) => {
          const segs = daySegments(transitions, day)
          const desc = segs.map((s) => `de ${formatMinute(s.from)} a ${s.to === 1440 ? '24:00' : formatMinute(s.to)}, ${formatTemp(s.sp)}`).join('; ')
          return (
            <div key={label}>
              <button
                type="button"
                className="week-row"
                style={{ width: '100%', background: 'none', border: 'none', padding: 0 }}
                aria-expanded={open === day}
                aria-label={`${DAY_NAMES[day]}: ${desc}`}
                onClick={() => setOpen(open === day ? null : day)}
              >
                <span className={`d ${day === today ? 'today' : ''}`}>{label}</span>
                <span className="bar">
                  {segs.map((s) => {
                    const width = ((s.to - s.from) / 1440) * 100
                    return (
                      <span key={s.from} className="seg" style={{ width: `${width}%`, background: s.sp === undefined ? undefined : colors.get(s.sp) }}>
                        {width >= 16 && s.sp !== undefined ? formatTemp(s.sp) : ''}
                      </span>
                    )
                  })}
                  {day === today && <i className="now" style={{ left: `${(nowMinute / 1440) * 100}%` }} />}
                </span>
              </button>
              {open === day && (
                <ul className="day-detail">
                  {segs.map((s) => (
                    <li key={s.from}>
                      {formatMinute(s.from)} – {s.to === 1440 ? '24:00' : formatMinute(s.to)} <b>{formatTemp(s.sp)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        <div className="week-scale" aria-hidden="true">
          <span />
          <div>
            <span>0h</span>
            <span>6h</span>
            <span>12h</span>
            <span>18h</span>
            <span>24h</span>
          </div>
        </div>
      </div>
      <p className="small muted">Toca un día para ver sus horas.</p>
    </div>
  )
}

// ---- editors ----------------------------------------------------------------------

function ScopeChoice(props: { zoneName: string; others: string[]; value: EditScope; onChange: (s: EditScope) => void }) {
  return (
    <div className="notice warn stack" style={{ display: 'flex', flexDirection: 'column' }}>
      <span>
        Este cambio también se aplica a <b>{joinNames(props.others)}</b>.
      </span>
      <div className="segmented" role="group" aria-label="A qué zonas aplicar">
        <button type="button" aria-pressed={props.value === 'zone'} onClick={() => props.onChange('zone')}>
          Solo {props.zoneName}
        </button>
        <button type="button" aria-pressed={props.value === 'all'} onClick={() => props.onChange('all')}>
          En todas
        </button>
      </div>
    </div>
  )
}

function EventEditor(props: {
  initial: ScheduleEvent
  events: ScheduleEvent[]
  zones: ZoneInfo[]
  zone: number
  isNew: boolean
  saving: boolean
  onSave: (ev: ScheduleEvent, scope: EditScope) => void
  onDelete: (scope: EditScope) => void
  onClose: () => void
}) {
  const [ev, setEv] = useState(props.initial)
  const [scope, setScope] = useState<EditScope>('zone')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const name = (i: number) => props.zones.find((z) => z.index === i)?.name ?? `Zona ${i + 1}`
  const shared = !props.isNew && props.initial.zones.length > 1
  const others = props.initial.zones.filter((z) => z !== props.zone).map(name)
  const dirty = JSON.stringify(ev) !== JSON.stringify(props.initial)
  // Splitting a shared change needs a free slot.
  const noRoom = shared && props.events.length >= SCHEDULE_SLOTS
  const effectiveScope: EditScope = noRoom ? 'all' : scope
  const zonesToShow = shared && effectiveScope === 'zone' ? [props.zone] : ev.zones
  const problems = [!zonesToShow.length && 'Elige al menos una zona.', !ev.days.some(Boolean) && 'Elige al menos un día.'].filter(Boolean)
  const candidate = { ...ev, zones: zonesToShow }
  const preview = props.isNew ? [...props.events, candidate] : applyEdit(props.events, props.initial, candidate, props.zone, effectiveScope)
  const clashes = groupConflicts(compact(preview)).filter((g) => g.minute === ev.minute && g.events.some((e) => e.setpoint === ev.setpoint))

  return (
    <Sheet
      title={props.isNew ? 'Nuevo cambio de temperatura' : 'Editar cambio'}
      onClose={props.onClose}
      dirty={dirty}
      actions={
        <div className="stack">
          {problems.length > 0 && <div className="notice warn">{problems.join(' ')}</div>}
          {!problems.length && clashes.length > 0 && (
            <div className="notice warn">
              Ojo: a las {formatMinute(ev.minute)} ya hay otro cambio con otra temperatura para{' '}
              {joinNames([...new Set(clashes.map((g) => name(g.zone)))])} ({describeDays(clashes[0].days).toLowerCase()}). Si guardas, tendrás que elegir
              cuál vale.
            </div>
          )}
          {confirmDelete ? (
            <div className="notice error stack" style={{ display: 'flex', flexDirection: 'column' }} role="alert">
              <span>
                {shared && effectiveScope === 'zone'
                  ? `Se quitará de ${name(props.zone)}. ${joinNames(others)} lo mantendrá.`
                  : shared
                    ? `Se borrará en ${joinNames([name(props.zone), ...others])}.`
                    : '¿Seguro que quieres borrar este cambio?'}
              </span>
              <div className="row">
                <button type="button" className="btn" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
                  No
                </button>
                <button type="button" className="btn btn-danger" style={{ flex: 1 }} disabled={props.saving} onClick={() => props.onDelete(effectiveScope)}>
                  Sí, borrar
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-heat btn-block"
                disabled={!!problems.length || props.saving}
                onClick={() => props.onSave(candidate, effectiveScope)}
              >
                {props.saving ? 'Guardando…' : 'Guardar'}
              </button>
              {!props.isNew && (
                <button type="button" className="btn-link" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete(true)}>
                  {shared && effectiveScope === 'zone' ? `Quitar de ${name(props.zone)}` : 'Borrar este cambio'}
                </button>
              )}
            </>
          )}
        </div>
      }
    >
      {shared && !noRoom && <ScopeChoice zoneName={name(props.zone)} others={others} value={scope} onChange={setScope} />}
      {noRoom && (
        <div className="notice warn">
          Este cambio también se aplica a <b>{joinNames(others)}</b>. Para cambiarlo solo en {name(props.zone)} haría falta un hueco libre y ya usas
          los {SCHEDULE_SLOTS}: lo que guardes se aplicará en todas. Si no quieres eso, borra antes otro cambio.
        </div>
      )}
      <TimeInput
        label="A las"
        value={ev.minute}
        onChange={(minute) => setEv({ ...ev, minute })}
        note={ev.minute < SMALL_HOURS ? 'Es de madrugada: elige el día en que empieza esa madrugada, por ejemplo el sábado para la noche del viernes.' : undefined}
      />
      <div className="stack">
        <strong>Poner la temperatura a</strong>
        <TempStepper big label="Temperatura" value={ev.setpoint} onChange={(setpoint) => setEv({ ...ev, setpoint })} />
      </div>
      <div className="stack">
        <strong>Qué días</strong>
        <DayPicker days={ev.days} onChange={(days) => setEv({ ...ev, days })} />
      </div>
      {!(shared && effectiveScope === 'zone') && (
        <div className="stack">
          <strong>En qué zonas</strong>
          <ZoneChips zones={props.zones} value={ev.zones} onChange={(zones) => setEv({ ...ev, zones })} />
        </div>
      )}
      <label className="switch-label row spread">
        Activo
        <Switch checked={ev.enabled} label="Cambio activo" onChange={(enabled) => setEv({ ...ev, enabled })} />
      </label>
      <p className="small muted">
        {describeDays(ev.days)}, a las {formatMinute(ev.minute)}, la temperatura deseada de {joinNames(zonesToShow.map(name)) || '…'} pasará a{' '}
        {formatTemp(ev.setpoint)} y se mantendrá hasta el siguiente cambio.
      </p>
    </Sheet>
  )
}

function RoutineWizard(props: {
  zones: ZoneInfo[]
  preselect: number[]
  events: ScheduleEvent[]
  saving: boolean
  onSave: (events: ScheduleEvent[]) => void
  onClose: () => void
}) {
  // Start with the days this zone does not have a schedule for yet.
  const covered = ALL_DAYS().map((_, d) => props.events.some((e) => logicalDays(e)[d] && e.zones.some((z) => props.preselect.includes(z))))
  const firstDays = covered.every(Boolean) || !covered.some(Boolean) ? WEEKDAYS() : covered.map((c) => !c)
  const [zones, setZones] = useState(props.preselect)
  const [days, setDays] = useState(firstDays)
  const [wake, setWake] = useState(firstDays[5] && !firstDays[0] ? 9 * 60 : 7 * 60)
  const [sleep, setSleep] = useState(23 * 60)
  const [comfort, setComfort] = useState(21)
  const [eco, setEco] = useState(18)
  const [away, setAway] = useState(false)
  const [leave, setLeave] = useState(8 * 60 + 30)
  const [back, setBack] = useState(17 * 60)
  const [touched, setTouched] = useState(false)

  const late = sleepsAfterMidnight({ wake, sleep })
  const sleepAbs = late ? sleep + 1440 : sleep
  const order = [wake, ...(away ? [leave, back] : []), sleepAbs]
  const ordered = order.every((m, i) => i === 0 || m > order[i - 1])
  const fresh = routineEvents({ zones, days, wake, sleep, comfort, eco, away: away ? { leave, back } : undefined })
  // A late bedtime lands on the next day but only adds one change there; the rest of that day is kept.
  const clearDays = days
  const result = compact([...removeCoverage(props.events, zones, clearDays), ...fresh])
  const tooMany = result.length > SCHEDULE_SLOTS
  const has = (d: number) => props.events.some((e) => logicalDays(e)[d] && e.zones.some((z) => zones.includes(z)))
  const replacedDays = ALL_DAYS().map((_, d) => clearDays[d] && has(d))
  const keptDays = ALL_DAYS().map((_, d) => !clearDays[d] && has(d))
  const problems = [
    !zones.length && 'Elige al menos una zona.',
    !days.some(Boolean) && 'Elige al menos un día.',
    !ordered && (away ? 'Las horas deben ir en orden: levantarse, salir, volver y acostarse.' : 'Revisa las horas de levantarse y acostarse.'),
    tooMany && `El horario tendría ${result.length} cambios y el máximo es ${SCHEDULE_SLOTS}. Usa menos zonas o copia el horario entre zonas.`,
  ].filter(Boolean)

  return (
    <Sheet
      title="Horario rápido"
      onClose={props.onClose}
      dirty={touched}
      actions={
        <div className="stack">
          {problems.length > 0 && <div className="notice warn">{problems.join(' ')}</div>}
          {!problems.length && replacedDays.some(Boolean) && (
            <div className="notice info">Sustituye el horario que ya había: {describeDays(replacedDays).toLowerCase()}.</div>
          )}
          {!problems.length && keptDays.some(Boolean) && <div className="notice ok">Se mantiene el horario de los demás días: {describeDays(keptDays).toLowerCase()}.</div>}
          <button type="button" className="btn btn-heat btn-block" disabled={!!problems.length || props.saving} onClick={() => props.onSave(result)}>
            {props.saving ? 'Guardando…' : 'Crear horario'}
          </button>
        </div>
      }
    >
      <div onChangeCapture={() => setTouched(true)} onClickCapture={() => setTouched(true)} className="stack" style={{ gap: 16 }}>
        <p className="muted">Dinos tu rutina y preparamos los cambios de temperatura por ti.</p>
        <div className="stack">
          <strong>Zonas</strong>
          <ZoneChips zones={props.zones} value={zones} onChange={setZones} />
        </div>
        <div className="stack">
          <strong>Días</strong>
          <DayPicker days={days} onChange={setDays} />
        </div>
        <TimeInput label="Me levanto a las" value={wake} onChange={setWake} />
        <label className="switch-label row spread">
          Salgo de casa durante el día
          <Switch checked={away} label="Salgo de casa durante el día" onChange={setAway} />
        </label>
        {away && (
          <div className="row" style={{ alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}>
              <TimeInput label="Salgo a las" value={leave} onChange={setLeave} />
            </div>
            <div style={{ flex: 1 }}>
              <TimeInput label="Vuelvo a las" value={back} onChange={setBack} />
            </div>
          </div>
        )}
        <TimeInput label="Me acuesto a las" value={sleep} onChange={setSleep} note={late ? 'De madrugada, ya el día siguiente.' : undefined} />
        <div className="stack">
          <strong>Temperatura cuando estoy en casa</strong>
          <TempStepper label="Temperatura cuando estoy en casa" value={comfort} onChange={setComfort} />
          <strong>Temperatura de noche{away ? ' y cuando no estoy' : ''}</strong>
          <TempStepper label="Temperatura de noche" value={eco} onChange={setEco} />
        </div>
        <div className="card small">
          <b>Resumen:</b> {describeDays(days)}: {formatMinute(wake)} → {formatTemp(comfort)}
          {away && `, ${formatMinute(leave)} → ${formatTemp(eco)}, ${formatMinute(back)} → ${formatTemp(comfort)}`}, {formatMinute(sleep)}
          {late ? ' (madrugada)' : ''} → {formatTemp(eco)}.
        </div>
      </div>
    </Sheet>
  )
}

function CopySheet(props: {
  zones: ZoneInfo[]
  source: number
  events: ScheduleEvent[]
  saving: boolean
  onSave: (events: ScheduleEvent[]) => void
  onClose: () => void
}) {
  const [targets, setTargets] = useState<number[]>([])
  const others = props.zones.filter((z) => z.index !== props.source)
  const name = props.zones.find((z) => z.index === props.source)?.name
  return (
    <Sheet
      title="Usar el mismo horario"
      onClose={props.onClose}
      actions={
        <button
          type="button"
          className="btn btn-heat btn-block"
          disabled={!targets.length || props.saving}
          onClick={() => props.onSave(compact(copyZoneSchedule(props.events, props.source, targets)))}
        >
          {props.saving ? 'Guardando…' : 'Copiar horario'}
        </button>
      }
    >
      <p>
        Las zonas que elijas seguirán exactamente el horario de <b>{name}</b>. Su horario actual se sustituirá.
      </p>
      <p className="small muted">
        No ocupa cambios nuevos. Si más adelante editas un cambio desde una de estas zonas, te preguntaremos si aplicarlo solo a esa o a todas.
      </p>
      <ZoneChips zones={others} value={targets} onChange={setTargets} />
    </Sheet>
  )
}

function ConflictNotice(props: { group: ConflictGroup; onKeep: (setpoint: number) => void; saving: boolean }) {
  const g = props.group
  return (
    <div className="notice warn stack" style={{ display: 'flex', flexDirection: 'column' }} role="alert">
      <span>
        A las <b>{formatMinute(g.minute)}</b> ({describeDays(g.days).toLowerCase()}) hay {g.events.length === 2 ? 'dos cambios' : `${g.events.length} cambios`} que piden
        temperaturas distintas: {joinNames(g.setpoints.map((s) => formatTemp(s)))}. ¿Con cuál te quedas?
      </span>
      <div className="row wrap">
        {g.setpoints.map((sp) => (
          <button key={sp} type="button" className="btn" disabled={props.saving} onClick={() => props.onKeep(sp)}>
            {formatTemp(sp)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- swipe to delete ---------------------------------------------------------------

const SWIPE_WIDTH = 104

/**
 * A row that slides left to reveal a delete button. Vertical scrolling keeps
 * working (touch-action: pan-y) and a tap on an open row closes it instead of
 * opening the editor.
 */
function SwipeRow(props: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  onDelete: () => void
  deleteLabel: string
  className: string
  children: ReactNode
}) {
  const drag = useRef<{ x: number; y: number; from: number; active: boolean; moved: boolean } | null>(null)
  // The browser fires a click right after a drag ends; that click is part of the swipe.
  const swallowClick = useRef(false)
  const [dx, setDx] = useState<number | null>(null)
  const offset = dx ?? (props.open ? -SWIPE_WIDTH : 0)

  const end = () => {
    const d = drag.current
    drag.current = null
    if (!d?.active) return
    swallowClick.current = true
    setTimeout(() => (swallowClick.current = false), 400)
    if ((dx ?? 0) < -SWIPE_WIDTH / 2) props.onOpen()
    else props.onClose()
    setDx(null)
  }

  return (
    <div className="swipe">
      <button
        type="button"
        className="swipe-delete"
        tabIndex={props.open ? 0 : -1}
        aria-hidden={!props.open}
        aria-label={props.deleteLabel}
        onClick={props.onDelete}
      >
        Borrar
      </button>
      <div
        className={props.className}
        style={{ transform: `translateX(${offset}px)`, transition: dx === null ? 'transform 0.2s ease' : 'none', touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY, from: props.open ? -SWIPE_WIDTH : 0, active: false, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const mx = e.clientX - d.x
          const my = e.clientY - d.y
          if (!d.active) {
            if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.5) {
              d.active = d.moved = true
              e.currentTarget.setPointerCapture(e.pointerId)
            } else if (Math.abs(my) > 10) {
              drag.current = null
              return
            } else return
          }
          setDx(Math.max(-SWIPE_WIDTH * 1.3, Math.min(0, d.from + mx)))
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onClickCapture={(e) => {
          // A swipe, or a tap on an open row, must not open the editor or flip the switch.
          if (swallowClick.current) {
            swallowClick.current = false
            e.stopPropagation()
            e.preventDefault()
          } else if (props.open) {
            e.stopPropagation()
            e.preventDefault()
            props.onClose()
          }
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

// ---- page ---------------------------------------------------------------------------

type Editing =
  | { kind: 'event'; ev: ScheduleEvent; isNew: boolean }
  | { kind: 'routine' }
  | { kind: 'copy' }
  | { kind: 'full' }
  | { kind: 'clear' }
  | null

/** First o'clock hour from 07:00 that this zone does not use yet. */
function freeMinute(events: ScheduleEvent[], zone: number): number {
  const used = new Set(events.filter((e) => e.zones.includes(zone)).map((e) => e.minute))
  for (let h = 7; h < 24; h++) if (!used.has(h * 60)) return h * 60
  return 12 * 60
}

export function SchedulePage({ initialZone }: { initialZone?: number }) {
  const s = useAppState()
  const c = useController()
  const zones = useMemo(() => zoneViews(s).map((v) => v.info), [s])
  const [zone, setZone] = useState<number>(initialZone ?? zones[0]?.index ?? 0)
  const [editing, setEditing] = useState<Editing>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  useEffect(() => {
    if (initialZone !== undefined) setZone(initialZone)
  }, [initialZone])

  if (!s.schedule) {
    return (
      <main className="page">
        <header className="page-header">
          <h1>Horario</h1>
        </header>
        <div className="card center muted">Cargando el horario…</div>
      </main>
    )
  }

  const events = s.schedule.events
  const zoneEvents = events.filter((e) => e.zones.includes(zone)).sort((a, b) => a.minute - b.minute)
  const conflicts = groupConflicts(events).filter((g) => g.zone === zone)
  const conflictIds = new Set(conflicts.flatMap((g) => g.events.map((e) => e.id)))
  const zoneName = (i: number) => zones.find((z) => z.index === i)?.name ?? `Zona ${i + 1}`
  const full = events.length >= SCHEDULE_SLOTS
  const orphans = events.filter((e) => !e.zones.length || !e.days.some(Boolean)).length
  const locked = !!s.away

  const save = async (next: ScheduleEvent[]) => {
    if (await c.saveSchedule(compact(next))) setEditing(null)
  }

  const keep = (g: ConflictGroup, setpoint: number) => {
    const winner = g.events.find((e) => e.setpoint === setpoint)
    const losers = new Set(g.events.filter((e) => e !== winner).map((e) => e.id))
    void save(events.flatMap((e) => (losers.has(e.id) ? removeCoverage([e], [g.zone], g.days) : [e])))
  }

  /** Saves a deletion and offers to undo it from the toast. */
  const removeWithUndo = (next: ScheduleEvent[], text: string) => {
    const previous = events
    setOpenRow(null)
    void c
      .saveSchedule(compact(next), { text, action: { label: 'Deshacer', run: () => void c.saveSchedule(previous, { text: 'Recuperado.' }) } })
      .then((ok) => ok && setEditing(null))
  }

  const swipeDelete = (ev: ScheduleEvent) => {
    const shared = ev.zones.length > 1
    removeWithUndo(
      applyDelete(events, ev, zone, 'zone'),
      shared ? `Cambio de las ${formatMinute(ev.minute)} quitado de ${zoneName(zone)}.` : `Cambio de las ${formatMinute(ev.minute)} borrado.`,
    )
  }

  const clearZone = () =>
    removeWithUndo(
      events.reduce((acc, ev) => (ev.zones.includes(zone) ? applyDelete(acc, ev, zone, 'zone') : acc), events),
      `Horario de ${zoneName(zone)} borrado.`,
    )

  const newEvent = (): ScheduleEvent => ({ id: newEventId(), enabled: true, days: ALL_DAYS(), minute: freeMinute(events, zone), zones: [zone], setpoint: 21 })

  return (
    <main className="page has-fab">
      <header className="page-header">
        <h1>Horario</h1>
        <span className="small muted">
          {events.length} de {SCHEDULE_SLOTS} cambios
        </span>
      </header>

      <AwayCard compact />

      {s.link !== 'online' && (
        <div className="notice info small" role="status">
          Sin conexión con tu calefacción. Puedes preparar el horario: se guardará en la nube y se aplicará cuando vuelva la conexión.
        </div>
      )}
      {s.scheduleSyncPending && (
        <div className="notice warn small" role="status">
          Horario guardado en la nube, pendiente de aplicar. Se aplicará solo en cuanto haya conexión.
        </div>
      )}

      {zones.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Zona">
          {zones.map((z) => (
            <button key={z.index} type="button" role="tab" className="chip" aria-selected={z.index === zone} onClick={() => setZone(z.index)}>
              {z.name}
            </button>
          ))}
        </div>
      )}

      {orphans > 0 && (
        <div className="notice with-action info small">
          <span style={{ flex: 1 }}>
            {orphans === 1 ? 'Hay 1 cambio' : `Hay ${orphans} cambios`} sin zonas o sin días (quizá de la app oficial). No hacen nada, pero ocupan sitio.
          </span>
          <button type="button" className="btn" disabled={s.scheduleSaving} onClick={() => void save(events)}>
            Limpiar
          </button>
        </div>
      )}

      {conflicts.map((g) => (
        <ConflictNotice key={`${g.minute}-${g.events.map((e) => e.id).join()}`} group={g} saving={s.scheduleSaving} onKeep={(sp) => keep(g, sp)} />
      ))}

      <div className={locked ? 'locked' : ''} inert={locked} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {zoneEvents.length === 0 ? (
        <div className="card stack center">
          <Illustration name="scheduleEmpty" />
          <h2>{zoneName(zone)} no tiene horario</h2>
          <p className="muted">La temperatura se queda como la dejes. Crea un horario para que cambie sola por la mañana y por la noche.</p>
          <button type="button" className="btn btn-heat" onClick={() => setEditing({ kind: 'routine' })}>
            Crear horario rápido
          </button>
          {zones.length > 1 && events.length > 0 && <p className="small muted">También puedes ir a otra zona y copiar su horario.</p>}
        </div>
      ) : (
        <>
          <WeekView events={events} zone={zone} />
          <section className="stack" aria-label={`Cambios de ${zoneName(zone)}`}>
            {zoneEvents.map((ev) => {
              const others = ev.zones.filter((z) => z !== zone)
              return (
                <SwipeRow
                  key={ev.id}
                  open={openRow === ev.id}
                  onOpen={() => setOpenRow(ev.id)}
                  onClose={() => setOpenRow(null)}
                  onDelete={() => swipeDelete(ev)}
                  deleteLabel={`Borrar el cambio de las ${formatMinute(ev.minute)}`}
                  className={`event ${ev.enabled ? '' : 'disabled'} ${conflictIds.has(ev.id) ? 'conflict' : ''}`}
                >
                  <button type="button" className="event-main" onClick={() => setEditing({ kind: 'event', ev, isNew: false })}>
                    <span className="time">{formatMinute(ev.minute)}</span>
                    <span className="what">
                      <b>{describeDays(ev.days)}</b>
                      <span className="small muted">
                        {!ev.enabled && 'Desactivado · '}
                        {ev.minute < SMALL_HOURS && 'Madrugada · '}
                        {others.length ? `También en ${joinNames(others.map(zoneName))}` : 'Solo esta zona'}
                      </span>
                    </span>
                    <span className={`temp ${tempTone(ev.setpoint)}`}>{formatTemp(ev.setpoint)}</span>
                  </button>
                  <Switch
                    checked={ev.enabled}
                    disabled={s.scheduleSaving}
                    label={`${ev.enabled ? 'Desactivar' : 'Activar'} el cambio de las ${formatMinute(ev.minute)} en ${zoneName(zone)}`}
                    onChange={(enabled) => {
                      const next = compact(applyEdit(events, ev, { ...ev, enabled }, zone, 'zone'))
                      if (next.length > SCHEDULE_SLOTS) {
                        c.toast('error', `Para cambiarlo solo en ${zoneName(zone)} hace falta un hueco libre (usas ${events.length} de ${SCHEDULE_SLOTS}). Ábrelo y aplícalo en todas, o borra otro cambio.`)
                        return
                      }
                      void save(next)
                    }}
                  />
                </SwipeRow>
              )
            })}
          </section>
          <p className="small muted">Desliza un cambio hacia la izquierda para borrarlo.</p>
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => setEditing({ kind: 'routine' })}>
              Horario rápido (añadir o cambiar días)
            </button>
            {zones.length > 1 && (
              <button type="button" className="btn" onClick={() => setEditing({ kind: 'copy' })}>
                Copiar a otras zonas
              </button>
            )}
          </div>
          <button type="button" className="btn btn-danger" onClick={() => setEditing({ kind: 'clear' })}>
            Borrar todo el horario…
          </button>
        </>
      )}

      </div>

      <p className="small muted">
        El horario se guarda en la nube de Orkli y funciona aunque el móvil esté apagado. Solo cambia la temperatura deseada: si una zona está
        apagada, sigue apagada.
      </p>

      {!locked && (
        <button type="button" className="fab" onClick={() => setEditing(full ? { kind: 'full' } : { kind: 'event', ev: newEvent(), isNew: true })}>
          <Icon name="plus" /> Añadir cambio
        </button>
      )}

      {editing?.kind === 'clear' && (
        <Sheet
          title="Borrar el horario"
          onClose={() => setEditing(null)}
          actions={
            <div className="stack">
              <button type="button" className="btn btn-danger btn-block" disabled={s.scheduleSaving} onClick={clearZone}>
                Borrar el horario de {zoneName(zone)}
              </button>
              {events.some((e) => e.zones.some((z) => z !== zone)) && (
                <button
                  type="button"
                  className="btn btn-danger btn-block"
                  disabled={s.scheduleSaving}
                  onClick={() => removeWithUndo([], 'Horario de toda la casa borrado.')}
                >
                  Borrar el horario de toda la casa
                </button>
              )}
              <button type="button" className="btn btn-block" onClick={() => setEditing(null)}>
                Cancelar
              </button>
            </div>
          }
        >
          <p>
            Las zonas se quedarán con la temperatura que tengan ahora y dejará de cambiar sola. Tendrás unos segundos para deshacerlo.
          </p>
        </Sheet>
      )}
      {editing?.kind === 'full' && (
        <Sheet title="Has llegado al máximo" onClose={() => setEditing(null)}>
          <p>
            La nube de Orkli admite como máximo {SCHEDULE_SLOTS} cambios para toda la casa, y ya los usas todos.
          </p>
          <p className="muted">
            Para hacer sitio, borra cambios que no uses o desactivados. Si varias zonas tienen el mismo horario, usa «Copiar a otras zonas»: comparten
            los mismos cambios y ocupan menos.
          </p>
        </Sheet>
      )}
      {editing?.kind === 'event' && (
        <EventEditor
          initial={editing.ev}
          events={events}
          zones={zones}
          zone={zone}
          isNew={editing.isNew}
          saving={s.scheduleSaving}
          onClose={() => setEditing(null)}
          onDelete={(scope) => void save(applyDelete(events, editing.ev, zone, scope))}
          onSave={(ev, scope) => void save(editing.isNew ? [...events, ev] : applyEdit(events, editing.ev, ev, zone, scope))}
        />
      )}
      {editing?.kind === 'routine' && (
        <RoutineWizard zones={zones} preselect={[zone]} events={events} saving={s.scheduleSaving} onClose={() => setEditing(null)} onSave={(next) => void save(next)} />
      )}
      {editing?.kind === 'copy' && (
        <CopySheet zones={zones} source={zone} events={events} saving={s.scheduleSaving} onClose={() => setEditing(null)} onSave={(next) => void save(next)} />
      )}
    </main>
  )
}
