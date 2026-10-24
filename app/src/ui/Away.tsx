import { useState } from 'react'
import { compact as liveEvents } from '../core/schedule'
import { useAppState, useController } from './app-context'
import { Sheet, TempStepper, formatTemp } from './components'

const since = (ts: number) =>
  new Date(ts).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

/** "Me voy unos días": banner while away, or a small entry point to start it. */
export function AwayCard({ compact }: { compact?: boolean }) {
  const s = useAppState()
  const c = useController()
  const [open, setOpen] = useState(false)
  const [temp, setTemp] = useState(16)
  const [busy, setBusy] = useState(false)

  if (s.away) {
    return (
      <div className="notice info stack" style={{ display: 'flex', flexDirection: 'column' }} role="status">
        <span>
          <b>Modo ausencia</b> desde el {since(s.away.since)}: todas las zonas a {formatTemp(s.away.temp)} y el horario en pausa. Para editar
          el horario, pulsa antes «Ya he vuelto».
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || s.link !== 'online'}
          onClick={async () => {
            setBusy(true)
            await c.endAway()
            setBusy(false)
          }}
        >
          {busy ? 'Volviendo a la normalidad…' : 'Ya he vuelto'}
        </button>
      </div>
    )
  }

  const events = liveEvents(s.schedule?.events ?? [])
  if (events.length && events.every((e) => !e.enabled)) {
    if (!compact) return null
    // Paused from another phone or by the official app: offer the way back.
    return (
      <div className="notice warn stack" style={{ display: 'flex', flexDirection: 'column' }} role="status">
        <span>Todo el horario está desactivado, así que las temperaturas no cambian solas.</span>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await c.enableAllChanges()
            setBusy(false)
          }}
        >
          {busy ? 'Activando…' : 'Activar todo el horario'}
        </button>
      </div>
    )
  }

  if (compact) return null

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Me voy unos días
      </button>
      {open && (
        <Sheet
          title="Me voy unos días"
          onClose={() => setOpen(false)}
          actions={
            <button
              type="button"
              className="btn btn-heat btn-block"
              disabled={busy || s.link !== 'online'}
              onClick={async () => {
                setBusy(true)
                if (await c.startAway(temp)) setOpen(false)
                setBusy(false)
              }}
            >
              {busy ? 'Activando…' : 'Activar modo ausencia'}
            </button>
          }
        >
          <p>Mientras estés fuera, todas las zonas se quedarán a una temperatura de mantenimiento y el horario se pausará.</p>
          <TempStepper big label="Temperatura de mantenimiento" value={temp} onChange={setTemp} />
          <div className="notice warn">
            Al volver tendrás que pulsar <b>«Ya he vuelto»</b>: la nube de Orkli no permite programar una fecha de vuelta. Recuperarás tu horario y las
            temperaturas que tenías.
          </div>
          {s.link !== 'online' && <div className="notice error">Ahora no hay conexión con tu calefacción.</div>}
        </Sheet>
      )}
    </>
  )
}
