import { useState } from 'react'
import { MODE_LABELS, type ModeNumber } from '../core/protocol'
import { DAY_NAMES, formatMinute, nextTransition, weekday, whenLabel, zoneTransitions } from '../core/schedule'
import { useAppState, useController } from './app-context'
import { Field, Illustration, Sheet, Switch, TempStepper, formatTemp, relativeTime, tempTone } from './components'
import { statusText, zoneViews } from './Home'

const PRESETS = [
  { label: 'Ahorro', value: 18 },
  { label: 'Noche', value: 19 },
  { label: 'Confort', value: 21 },
]

export function ZoneSheet({ zone, onClose, onEditSchedule }: { zone: number; onClose: () => void; onEditSchedule: () => void }) {
  const s = useAppState()
  const c = useController()
  const z = zoneViews(s).find((v) => v.info.index === zone)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(z?.info.name ?? '')
  if (!z) return null
  const offline = s.link !== 'online'
  const st = statusText(z)
  const today = weekday(new Date())
  const todays = zoneTransitions(s.schedule?.events ?? [], zone).filter((t) => t.day === today)
  const next = nextTransition(s.schedule?.events ?? [], zone)

  return (
    <Sheet title={z.info.name} onClose={onClose}>
      {offline && (
        <div className="notice error" role="status">
          Sin conexión con tu calefacción: ahora no se pueden hacer cambios.
        </div>
      )}
      <div className="row spread">
        <span className={`zone-status ${st.tone}`} style={{ fontSize: '1rem' }}>
          {st.text}
        </span>
        <label className="switch-label">
          {z.on ? 'Encendida' : 'Apagada'}
           <Switch checked={!!z.on} disabled={z.on === undefined || offline} label="Encender o apagar la zona" onChange={(v) => c.setPower(zone, v)} />
        </label>
      </div>

      {z.on === false && (
        <div className="stack center">
          <Illustration name="zoneOff" />
          <p className="muted">Esta zona está apagada. Puedes ajustar la temperatura igualmente; se usará cuando la enciendas.</p>
        </div>
      )}

      {z.setpoint !== undefined && (
        <div className={`card ${z.pendingSetpoint ? 'pending' : ''}`}>
          <div className="center muted">Temperatura deseada</div>
          <TempStepper big disabled={offline} label="Temperatura deseada" value={z.setpoint} onChange={(v) => c.setSetpoint(zone, v)} />
          <div className="chips" style={{ justifyContent: 'center' }}>
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="chip" disabled={offline} aria-pressed={z.setpoint === p.value} onClick={() => c.setSetpoint(zone, p.value)}>
                {p.label} {formatTemp(p.value, 0)}
              </button>
            ))}
          </div>
          {z.pendingSetpoint && <p className="center small muted">Enviando al termostato…</p>}
          {next && z.on !== false && (
            <p className="center small muted">
              Se mantendrá hasta {whenLabel(next.inMinutes)} a las {formatMinute(next.minute)}, cuando el horario la pondrá a {formatTemp(next.setpoint)}.
            </p>
          )}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <b>{formatTemp(z.state.ambient)}</b>
          <span>Ahora</span>
        </div>
        <div className="stat">
          <b>{z.state.humidity !== undefined ? `${Math.round(z.state.humidity)} %` : '—'}</b>
          <span>Humedad</span>
        </div>
        <div className="stat">
          <b>{z.mode ? (z.mode % 2 ? 'Frío' : 'Calor') : '—'}</b>
          <span>{z.mode ? MODE_LABELS[z.mode as ModeNumber].replace(/^(Frío|Calor) /, '') : 'Modo'}</span>
        </div>
      </div>

      <section className="stack">
        <div className="row spread">
          <h3>Horario de hoy ({DAY_NAMES[today].toLowerCase()})</h3>
          <button type="button" className="btn-link" onClick={onEditSchedule}>
            Editar
          </button>
        </div>
        {todays.length === 0 ? (
          <p className="muted">Hoy no hay cambios programados para esta zona.</p>
        ) : (
          <div className="chips">
            {todays.map((t) => (
              <span key={`${t.minute}-${t.event.id}`} className={`temp ${tempTone(t.setpoint)} chip`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {formatMinute(t.minute)} → {formatTemp(t.setpoint)}
              </span>
            ))}
          </div>
        )}
        <p className="small muted">
          El horario solo cambia la temperatura deseada; no enciende ni apaga la zona.
        </p>
      </section>

      <section className="stack">
        {renaming ? (
          <>
            <Field label="Nombre de la zona" value={name} onChange={setName} hint="Se guarda en la nube: lo verán todos los móviles de casa." autoFocus />
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!name.trim()}
                onClick={async () => {
                  setRenaming(false)
                  const where = await c.renameZone(zone, name)
                  c.toast(
                    where === 'cloud' ? 'success' : 'info',
                    where === 'cloud' ? 'Nombre cambiado en todos los móviles.' : 'Nombre cambiado solo en este móvil: no se ha podido guardar en la nube.',
                  )
                }}
              >
                Guardar nombre
              </button>
              <button type="button" className="btn" onClick={() => setRenaming(false)}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setRenaming(true)}>
            Cambiar nombre
          </button>
        )}
        <p className="small muted center">Última lectura {relativeTime(z.state.updatedAt)} · Zona {zone + 1}</p>
      </section>
    </Sheet>
  )
}
