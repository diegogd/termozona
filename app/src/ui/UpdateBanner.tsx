import { Browser } from '@capacitor/browser'
import { useAppState } from './app-context'

export const openExternal = (url: string) => void Browser.open({ url }).catch(() => window.open(url, '_blank'))

/** Tells people a newer APK exists and how to install it. */
export function UpdateBanner({ detailed }: { detailed?: boolean }) {
  const { update } = useAppState()
  if (!update) return null
  return (
    <div className="notice info stack" style={{ display: 'flex', flexDirection: 'column' }} role="status">
      <span>
        <b>Hay una versión nueva de la app ({update.version}).</b>
        {detailed && ' Al descargarla, abre el fichero y pulsa «Actualizar». No perderás tu sesión ni tus ajustes.'}
      </span>
      <button type="button" className="btn btn-primary" onClick={() => openExternal(update.url)}>
        Descargar la nueva versión
      </button>
    </div>
  )
}
