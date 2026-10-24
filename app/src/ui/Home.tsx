import { useEffect, useState } from 'react'
import type { AppState } from '../core/controller'
import type { ZoneInfo } from '../core/installation'
import { MODE_LABELS, isCoolingMode, isDemanding, type ModeNumber, type ZoneState } from '../core/protocol'
import { formatMinute, nextTransition, whenLabel, type ScheduleEvent } from '../core/schedule'
import { AwayCard } from './Away'
import { UpdateBanner } from './UpdateBanner'
import { useAppState, useController } from './app-context'
import { Icon, Illustration, Sheet, Switch, TempStepper, formatTemp, relativeTime } from './components'

export interface ZoneView {
  info: ZoneInfo
  state: ZoneState
  on: boolean | undefined
  setpoint: number | undefined
  mode: number | undefined
  pendingOn: boolean
  pendingSetpoint: boolean
  demanding: boolean
}

export function zoneViews(s: AppState): ZoneView[] {
  // Zones from the project file, plus any zone the device reports that the file misses.
  const infos = [...s.zones]
  for (const z of Object.values(s.device.zones)) {
    if (!infos.some((i) => i.index === z.index) && z.setpoint !== undefined) infos.push({ index: z.index, name: `Zona ${z.index + 1}` })
  }
  return infos
    .sort((a, b) => a.index - b.index)
    .map((info) => {
      const state = s.device.zones[info.index] ?? { index: info.index }
      const pending = s.pending[info.index] ?? []
      const pOn = pending.find((p) => p.field === 'on')
      const pSp = pending.find((p) => p.field === 'setpoint')
      const pMode = pending.find((p) => p.field === 'mode')
      const on = pOn ? (pOn.value as boolean) : state.on
      const setpoint = pSp ? (pSp.value as number) : state.setpoint
      const mode = pMode ? (pMode.value as number) : state.mode
      return {
        info,
        state,
        on,
        setpoint,
        mode,
        pendingOn: !!pOn,
        pendingSetpoint: !!pSp,
        demanding: isDemanding({ ...state, on, setpoint, mode }),
      }
    })
}

export function statusText(z: ZoneView): { text: string; tone: '' | 'heat' | 'cool' } {
  if (z.on === undefined) return { text: 'Esperando datos…', tone: '' }
  if (!z.on) return { text: 'Apagada', tone: '' }
  const cooling = z.mode !== undefined && isCoolingMode(z.mode)
  if (z.demanding) return { text: cooling ? 'Enfriando' : 'Calentando', tone: cooling ? 'cool' : 'heat' }
  return { text: 'Temperatura alcanzada', tone: '' }
}

function NextChange({ events, zone, off, away }: { events: ScheduleEvent[]; zone: number; off: boolean; away: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  if (away) return <span>Horario en pausa (modo ausencia)</span>
  const next = nextTransition(events, zone, now)
  if (!next) return <span>Sin horario</span>
  if (off) return <span>Tiene horario, pero está apagada: el horario no la enciende</span>
  return (
    <span>
      Próximo: <b>{formatTemp(next.setpoint)}</b> {whenLabel(next.inMinutes, now)} a las {formatMinute(next.minute)}
    </span>
  )
}

function ZoneCard({ z, events, onOpen, offline, away }: { z: ZoneView; events: ScheduleEvent[]; onOpen: () => void; offline: boolean; away: boolean }) {
  const c = useController()
  const st = statusText(z)
  const cooling = z.mode !== undefined && isCoolingMode(z.mode)
  const cls = !z.on ? 'off' : cooling ? 'cool' : 'heat'
  return (
    <article className={`zone ${cls}`} aria-label={z.info.name}>
      <div className="zone-head">
        <button type="button" className="zone-name" onClick={onOpen}>
          {z.info.name}
          <span className={`zone-status ${st.tone}`}>
            {st.tone === 'heat' && <Icon name="flame" />} {st.tone === 'cool' && <Icon name="snow" />} {st.text}
          </span>
        </button>
        <div className={z.pendingOn ? 'pending' : ''}>
          <Switch
            checked={!!z.on}
            disabled={z.on === undefined || offline}
            label={`${z.info.name}: ${z.on ? 'encendida' : 'apagada'}`}
            onChange={(v) => c.setPower(z.info.index, v)}
          />
        </div>
      </div>
      <div className="zone-body">
        <button type="button" className="reading" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left' }} onClick={onOpen}>
          <span className="value">{formatTemp(z.state.ambient)}</span>
          <span className="label">Ahora</span>
          {z.state.humidity !== undefined && <span className="label">{Math.round(z.state.humidity)} % humedad</span>}
        </button>
        {z.setpoint !== undefined && (
          <div className={z.pendingSetpoint ? 'pending' : ''}>
            <TempStepper disabled={offline} label={`Temperatura deseada en ${z.info.name}`} value={z.setpoint} onChange={(v) => c.setSetpoint(z.info.index, v)} />
            <div className="center small muted">Deseada</div>
          </div>
        )}
      </div>
      <div className="zone-foot">
        <NextChange events={events} zone={z.info.index} off={z.on === false} away={away} />
        <button type="button" className="btn-link" onClick={onOpen}>
          Detalles
        </button>
      </div>
    </article>
  )
}

function ModeSelector({ s }: { s: AppState }) {
  const c = useController()
  const [confirm, setConfirm] = useState<ModeNumber | null>(null)
  const heatModes = s.device.availableModes.filter((m) => !isCoolingMode(m))
  const coolModes = s.device.availableModes.filter((m) => isCoolingMode(m))
  const views = zoneViews(s)
  const current = views.find((v) => v.mode !== undefined)?.mode
  if (!heatModes.length || !coolModes.length || current === undefined) return null
  const cooling = isCoolingMode(current)
  const pick = (m: ModeNumber) => {
    if (m === current) return
    setConfirm(m)
  }
  return (
    <>
      <div className="segmented" role="group" aria-label="Modo de toda la casa">
        <button type="button" className="heat" aria-pressed={!cooling} onClick={() => pick(heatModes[0])}>
          Calefacción
        </button>
        <button type="button" className="cool" aria-pressed={cooling} onClick={() => pick(coolModes[0])}>
          Refrigeración
        </button>
      </div>
      {confirm !== null && (
        <Sheet
          title={isCoolingMode(confirm) ? '¿Pasar a refrigeración?' : '¿Pasar a calefacción?'}
          onClose={() => setConfirm(null)}
          actions={
            <div className="stack">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => {
                  c.setMode(confirm)
                  setConfirm(null)
                }}
              >
                Sí, cambiar toda la casa
              </button>
              <button type="button" className="btn btn-block" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          }
        >
          <p>
            El modo es común a <b>todas las zonas</b>: se cambiará en toda la casa a <b>{MODE_LABELS[confirm].toLowerCase()}</b>.
          </p>
          {isCoolingMode(confirm) && (
            <div className="notice warn">
              Con suelo refrescante, si la humedad es alta puede condensarse agua en el suelo. El sistema lo vigila, pero
              revisa el aviso de punto de rocío si aparece.
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}

export function LinkPill({ s }: { s: AppState }) {
  const c = useController()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const labels = { online: 'Conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…', offline: 'Sin conexión' }
  return (
    <button
      type="button"
      className={`pill ${s.link}`}
      onClick={() => c.resume()}
      aria-label={`${labels[s.link]}. Actualizado ${relativeTime(s.lastUpdate)}. Pulsa para actualizar.`}
    >
      <span className="dot" />
      {labels[s.link]}
      {s.link !== 'online' && s.lastUpdate ? ` · ${relativeTime(s.lastUpdate)}` : ''}
    </button>
  )
}

export function Home({ onOpenZone }: { onOpenZone: (zone: number) => void }) {
  const s = useAppState()
  const c = useController()
  const views = zoneViews(s)
  const events = s.schedule?.events ?? []
  const [allOff, setAllOff] = useState(false)
  const anyOn = views.some((v) => v.on)
  const hasData = views.some((v) => v.on !== undefined)
  // 'connecting' right after opening the app is not a lost connection.
  const offline = s.link === 'offline' || s.link === 'reconnecting'

  return (
    <main className="page">
      <header className="page-header">
        <h1>Mi casa</h1>
        <LinkPill s={s} />
      </header>

      {offline && hasData && (
        <div className="notice with-action error offline-banner" role="status">
          <span style={{ flex: 1 }}>
            Sin conexión con tu calefacción{s.lastUpdate ? `. Últimos datos: ${relativeTime(s.lastUpdate)}` : ''}. Los datos pueden no estar al día y no se
            pueden hacer cambios.
          </span>
          <button type="button" className="btn" onClick={() => c.resume()}>
            Reintentar
          </button>
        </div>
      )}

      <AwayCard compact />
      <UpdateBanner />

      {s.demo && <div className="notice info">Modo demostración: nada de lo que hagas aquí afecta a una calefacción real.</div>}

      {s.device.dewAlarm > 0 && (
        <div className="notice warn" role="alert">
          Aviso de punto de rocío: hay riesgo de condensación. El sistema ha limitado la refrigeración por suelo.
        </div>
      )}

      {s.link === 'offline' && !hasData && (
        <div className="card stack center">
          <Illustration name="connectionError" />
          <h2>No llegamos a tu calefacción</h2>
          <p className="muted">Comprueba que el móvil tiene internet. Si el problema sigue, puede que el TermoWifi se haya desconectado de la Wi-Fi de casa.</p>
          <button type="button" className="btn btn-primary" onClick={() => c.resume()}>
            Reintentar
          </button>
        </div>
      )}

      <ModeSelector s={s} />

      {views.length === 0 && s.link !== 'offline' && (
        <div className="card center muted" aria-busy="true">
          Cargando tus zonas…
        </div>
      )}

      {views.map((z) => (
        <ZoneCard key={z.info.index} z={z} events={events} offline={offline} away={!!s.away} onOpen={() => onOpenZone(z.info.index)} />
      ))}

      {hasData && !offline && (
        <div className="row wrap">
          {!s.away && <AwayCard />}
          {anyOn ? (
            <button type="button" className="btn" onClick={() => setAllOff(true)}>
              Apagar todas las zonas
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => views.forEach((v) => c.setPower(v.info.index, true))}>
              Encender todas las zonas
            </button>
          )}
        </div>
      )}

      {allOff && (
        <Sheet
          title="¿Apagar todas las zonas?"
          onClose={() => setAllOff(false)}
          actions={
            <div className="stack">
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => {
                  views.filter((v) => v.on).forEach((v) => c.setPower(v.info.index, false))
                  setAllOff(false)
                }}
              >
                Apagar todas
              </button>
              <button type="button" className="btn btn-block" onClick={() => setAllOff(false)}>
                Cancelar
              </button>
            </div>
          }
        >
          <p>Las zonas dejarán de calentar o enfriar hasta que las vuelvas a encender.</p>
        </Sheet>
      )}
    </main>
  )
}
