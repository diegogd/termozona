import { useEffect, useMemo, useState } from 'react'
import { useAppState, useController } from './app-context'
import { RELEASES_PAGE } from '../core/updates'
import { pushBack } from './back'
import { Sheet, relativeTime } from './components'
import { UpdateBanner, openExternal } from './UpdateBanner'
import { WifiSetup } from './WifiSetup'

export function Settings() {
  const s = useAppState()
  const c = useController()
  const [confirm, setConfirm] = useState(false)
  const [wifi, setWifi] = useState(false)
  const bridge = useMemo(() => c.setupBridge(s.demo), [c, s.demo])
  useEffect(() => (wifi ? pushBack(() => setWifi(false)) : undefined), [wifi])

  if (wifi) {
    return (
      <main className="page" style={{ paddingBottom: 32 }}>
        <header className="page-header">
          <button type="button" className="btn-link" onClick={() => setWifi(false)}>
            ← Ajustes
          </button>
        </header>
        <WifiSetup
          bridge={bridge}
          onDone={() => {
            setWifi(false)
            c.toast('info', 'En un par de minutos tu calefacción volverá a estar conectada.')
            setTimeout(() => c.resume(), 90_000)
          }}
        />
      </main>
    )
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Ajustes</h1>
      </header>

      <section className="list" aria-label="Cuenta">
        <div>
          <span>Usuario</span>
          <b>{s.user}</b>
        </div>
        <div>
          <span>TermoWifi</span>
          <b>{s.ident ? s.ident.replace(/^W/, 'Ing_') : '—'}</b>
        </div>
        <div>
          <span>Última actualización</span>
          <span className="muted">{relativeTime(s.lastUpdate)}</span>
        </div>
        <button type="button" onClick={() => c.resume()}>
          <span>Actualizar ahora</span>
          <span aria-hidden="true">↻</span>
        </button>
        <button type="button" onClick={() => setWifi(true)}>
          <span>
            Conectar el TermoWifi a la Wi-Fi
            <br />
            <span className="small muted">Si has cambiado de router o de contraseña</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      </section>

      <UpdateBanner detailed />

      <section className="list" aria-label="Aplicación">
        <div>
          <span>Versión de la app</span>
          <b>{__APP_VERSION__}</b>
        </div>
        <button type="button" onClick={() => void c.checkUpdates(__APP_VERSION__, true).then(() => !c.getState().update && c.toast('info', 'Tienes la última versión.'))}>
          <span>Buscar actualizaciones</span>
          <span aria-hidden="true">↻</span>
        </button>
        <button type="button" onClick={() => openExternal(RELEASES_PAGE)}>
          <span>Página de descargas</span>
          <span aria-hidden="true">↗</span>
        </button>
      </section>

      <section className="card stack small">
        <h2 style={{ fontSize: '1.05rem' }}>Cómo funciona</h2>
        <p>
          TermoZona habla con la misma nube que la app oficial de Orkli, así que puedes seguir usando las dos. Los cambios que hagas en una se ven
          en la otra.
        </p>
        <p>
          Los nombres de las zonas y el horario se guardan en la nube, así que los verán todos los móviles de casa. El horario se aplica aunque el
          móvil esté apagado.
        </p>
        <p className="muted">App no oficial, sin relación con Orkli ni Ingenium. Úsala bajo tu responsabilidad.</p>
      </section>

      <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirm(true)}>
        Cerrar sesión
      </button>

      {confirm && (
        <Sheet
          title="¿Cerrar sesión?"
          onClose={() => setConfirm(false)}
          actions={
            <div className="stack">
              <button type="button" className="btn btn-primary btn-block" onClick={() => void c.signOut()}>
                Cerrar sesión
              </button>
              <button type="button" className="btn btn-block" onClick={() => setConfirm(false)}>
                Cancelar
              </button>
            </div>
          }
        >
          <p>
            {s.away
              ? 'Tienes el modo ausencia activo y seguirá activo. Al volver a entrar (desde aquí o desde otro móvil) podrás pulsar «Ya he vuelto».'
              : 'Tu calefacción y su horario seguirán funcionando igual.'}{' '}
            Necesitarás tu usuario y contraseña para volver a entrar.
          </p>
        </Sheet>
      )}
    </main>
  )
}
