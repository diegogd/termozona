import { useState } from 'react'
import { RELEASES_PAGE } from '../core/updates'
import { installUpdate, isNativePlatform, openUrl } from '../native/capacitorBridge'
import { useAppState } from './app-context'

export const openExternal = (url: string) => void openUrl(url).catch(() => window.open(url, '_blank'))

type Step = { kind: 'idle' } | { kind: 'downloading'; pct: number } | { kind: 'installer' } | { kind: 'permission' } | { kind: 'error' }

/** Tells people a newer APK exists and installs it without going through the browser. */
export function UpdateBanner({ detailed }: { detailed?: boolean }) {
  const { update } = useAppState()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  if (!update) return null

  const install = async () => {
    if (!isNativePlatform()) return openExternal(update.url)
    setStep({ kind: 'downloading', pct: 0 })
    const result = await installUpdate(update.url, (pct) => setStep({ kind: 'downloading', pct }))
    setStep({ kind: result === 'started' ? 'installer' : result })
  }

  return (
    <div className="notice info stack" style={{ display: 'flex', flexDirection: 'column' }} role="status">
      <span>
        <b>Hay una versión nueva de la app ({update.version}).</b>
        {detailed && step.kind === 'idle' && ' No perderás tu sesión ni tus ajustes.'}
      </span>

      {step.kind === 'downloading' && (
        <>
          <span>Descargando… {step.pct >= 0 ? `${step.pct} %` : ''}</span>
          <div className="progress" role="progressbar" aria-valuenow={Math.max(0, step.pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.max(5, step.pct)}%` }} />
          </div>
        </>
      )}
      {step.kind === 'installer' && <span>En la pantalla que se abre, pulsa «Actualizar».</span>}
      {step.kind === 'permission' && (
        <span>
          Android necesita tu permiso la primera vez: en la pantalla que se ha abierto, activa el interruptor (según el móvil se llama
          «Permitir de esta fuente» o «Autorizar de esta fuente»), vuelve aquí y pulsa otra vez «Actualizar ahora».
        </span>
      )}
      {step.kind === 'error' && <span>No se ha podido descargar. Comprueba la conexión o descárgala desde el navegador.</span>}

      {step.kind !== 'downloading' && (
        <button type="button" className="btn btn-primary" onClick={() => void install()}>
          {step.kind === 'installer' ? 'Volver a abrir el instalador' : 'Actualizar ahora'}
        </button>
      )}
      {(step.kind === 'error' || detailed) && (
        <button type="button" className="btn-link" onClick={() => openExternal(RELEASES_PAGE)}>
          Descargar desde el navegador
        </button>
      )}
    </div>
  )
}
