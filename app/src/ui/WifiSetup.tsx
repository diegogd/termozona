import { useEffect, useRef, useState } from 'react'
import type { Bridge, WifiNetwork } from '../core/bridge'
import { Field } from './components'

/** Fixed password of the "Ing_XXXXXX" network a TermoWifi opens in setup mode. */
export const DEVICE_AP_PASSWORD = '1234567890'

type Phase = 'blink' | 'join' | 'home' | 'sending' | 'done'
const PHASES: Phase[] = ['blink', 'join', 'home', 'done']

const is5GHz = (n: WifiNetwork) => (n.frequency ?? 0) > 4000
const byteLength = (s: string) => new TextEncoder().encode(s).length

/**
 * Connects a TermoWifi to the home Wi-Fi: setup mode on the main panel, the
 * phone joins its "Ing_" network, and the app sends the home SSID and password.
 * Used when signing up and from Ajustes (new router or new Wi-Fi password).
 */
export function WifiSetup(props: { bridge: Bridge; onDone: (deviceSsid?: string) => void; onSkip?: () => void; skipLabel?: string }) {
  const { bridge } = props
  const [phase, setPhase] = useState<Phase>('blink')
  const [error, setError] = useState<string>()
  const [tips, setTips] = useState(false)
  // joining the device network
  const [joining, setJoining] = useState(false)
  const [manual, setManual] = useState(!bridge.joinDeviceWifi)
  const [deviceSsid, setDeviceSsid] = useState<string>()
  const joined = useRef(false)
  // home network
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)

  // Never leave the phone stuck on the TermoWifi's network (it has no Internet).
  useEffect(
    () => () => {
      if (joined.current) void bridge.leaveDeviceWifi?.()
    },
    [bridge],
  )

  const go = (p: Phase) => {
    setError(undefined)
    setPhase(p)
  }

  /** The Wi-Fi the phone is on before switching is very likely the home one. */
  const rememberHome = async () => {
    const now = await bridge.currentWifi?.().catch(() => null)
    if (now && !now.startsWith('Ing_')) setSsid((s) => s || now)
  }

  const join = async () => {
    if (!bridge.joinDeviceWifi) return setManual(true)
    setJoining(true)
    setError(undefined)
    const r = await bridge.joinDeviceWifi()
    setJoining(false)
    if (r.ok) {
      joined.current = true
      setDeviceSsid(r.ssid)
      return go('home')
    }
    setManual(true)
    setError(
      r.reason === 'unsupported'
        ? undefined
        : 'No hemos podido conectar con el TermoWifi. Comprueba que su luz sigue parpadeando, o conéctate a mano como se explica abajo.',
    )
  }

  const startJoin = async () => {
    go('join')
    await rememberHome()
    if (!manual) await join()
  }

  const checkManual = async () => {
    const now = await bridge.currentWifi?.().catch(() => null)
    if (now && !now.startsWith('Ing_')) {
      setError(`El móvil sigue conectado a «${now}». Conéctate a la red que empieza por Ing_ y vuelve aquí.`)
      return
    }
    if (now) setDeviceSsid(now)
    go('home')
  }

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(DEVICE_AP_PASSWORD)
    } catch {
      // The password is on screen anyway.
    }
  }

  const scan = async () => {
    if (!bridge.scanWifi) return
    setScanning(true)
    try {
      setNetworks((await bridge.scanWifi()).filter((n) => !n.ssid.startsWith('Ing_')))
    } catch {
      setError('No se han podido buscar redes. Escribe el nombre a mano.')
    } finally {
      setScanning(false)
    }
  }

  const chosen = networks?.filter((n) => n.ssid === ssid.trim()) ?? []
  const only5GHz = chosen.length > 0 && chosen.every(is5GHz)
  const ssidError = !ssid.trim()
    ? undefined
    : byteLength(ssid.trim()) > 32
      ? 'El nombre de la Wi-Fi es demasiado largo (máximo 32 caracteres).'
      : only5GHz
        ? 'Esta red es de 5 GHz y el TermoWifi solo funciona con redes de 2,4 GHz. Elige la otra red de tu router.'
        : undefined
  const passError = byteLength(password) > 63 ? 'La contraseña es demasiado larga (máximo 63 caracteres).' : undefined

  const send = async () => {
    if (!bridge.provisionWifi || !ssid.trim() || ssidError || passError) return
    go('sending')
    setProgress(0)
    try {
      await bridge.provisionWifi(ssid.trim(), password, setProgress)
      if (joined.current) {
        joined.current = false
        await bridge.leaveDeviceWifi?.()
      }
      go('done')
    } catch {
      setPhase('home')
      setError(
        'El TermoWifi no responde. Comprueba que su luz sigue parpadeando y que el móvil sigue conectado a su red (Ing_…). Si ha dejado de parpadear, vuelve a mantener pulsada la tecla Wi-Fi y reintenta.',
      )
    }
  }

  const index = PHASES.indexOf(phase === 'sending' ? 'home' : phase)

  return (
    <section className="stack">
      <p className="small muted" aria-live="polite">
        Conectar a la Wi-Fi · {index + 1} de {PHASES.length}
      </p>

      {phase === 'blink' && (
        <>
          <h1>Pon el TermoWifi en modo configuración</h1>
          <PanelDrawing />
          <ol className="stack" style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              Ve al <b>panel principal</b> del TermoWifi, el de la casa (no los termostatos de cada habitación).
            </li>
            <li>
              <b>Mantén pulsada la tecla Wi-Fi</b> unos segundos, hasta que su luz <b>empiece a parpadear</b>. Entonces suéltala.
            </li>
          </ol>
          <p className="muted small">
            Mientras parpadea, el TermoWifi abre su propia red Wi-Fi, con un nombre que empieza por <b>Ing_</b>, para que el móvil le pase los
            datos de tu casa.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => void startJoin()}>
            Ya parpadea
          </button>
          <button type="button" className="btn-link" aria-expanded={tips} onClick={() => setTips(!tips)}>
            No consigo que parpadee
          </button>
          {tips && (
            <div className="notice info">
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Mantén la tecla pulsada más tiempo, hasta 10 segundos, sin soltarla.</li>
                <li>Comprueba que el panel tiene corriente (alguna luz encendida).</li>
                <li>Si acabas de enchufarlo, espera un minuto y vuelve a probar.</li>
                <li>Si aun así no parpadea, consulta a tu instalador.</li>
              </ul>
            </div>
          )}
          {props.onSkip && (
            <button type="button" className="btn-link" onClick={props.onSkip}>
              {props.skipLabel ?? 'Saltar este paso'}
            </button>
          )}
        </>
      )}

      {phase === 'join' && (
        <>
          <h1>Conecta el móvil al TermoWifi</h1>
          {!manual ? (
            <>
              <p>
                Android te preguntará si quieres conectarte a una red que empieza por <b>Ing_</b>. Elígela y pulsa <b>«Conectar»</b>.
              </p>
              <p className="muted small">Es solo un momento: al terminar, el móvil volverá solo a tu Wi-Fi.</p>
              {joining ? (
                <p className="center muted" role="status">
                  Buscando el TermoWifi…
                </p>
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={() => void join()}>
                  Conectar con el TermoWifi
                </button>
              )}
            </>
          ) : (
            <>
              {error && <div className="notice warn">{error}</div>}
              <ol className="stack" style={{ margin: 0, paddingLeft: 22 }}>
                <li>
                  Abre los ajustes de Wi-Fi del móvil y elige la red que empieza por <b>Ing_</b>.
                </li>
                <li>
                  Pon esta contraseña:
                  <div className="ap-password">
                    <code>{DEVICE_AP_PASSWORD}</code>
                    <button type="button" className="btn" onClick={() => void copyPassword()}>
                      Copiar
                    </button>
                  </div>
                </li>
                <li>
                  Si Android avisa de que esa red <b>no tiene Internet</b>, elige <b>«Mantener conexión»</b> o <b>«Sí»</b>: es normal.
                </li>
                <li>Vuelve a TermoZona.</li>
              </ol>
              {bridge.openWifiSettings && (
                <button type="button" className="btn btn-block" onClick={() => void bridge.openWifiSettings?.()}>
                  Abrir ajustes de Wi-Fi
                </button>
              )}
              <button type="button" className="btn btn-primary btn-block" onClick={() => void checkManual()}>
                Ya estoy conectado
              </button>
              {bridge.joinDeviceWifi && (
                <button type="button" className="btn-link" onClick={() => (setManual(false), void join())}>
                  Probar otra vez la conexión automática
                </button>
              )}
            </>
          )}
          <button type="button" className="btn-link" onClick={() => go('blink')}>
            ← Volver
          </button>
        </>
      )}

      {(phase === 'home' || phase === 'sending') && (
        <>
          <h1>¿A qué Wi-Fi de casa se conecta?</h1>
          {deviceSsid && <div className="notice ok">Móvil conectado a {deviceSsid}.</div>}
          <p className="muted small">
            El TermoWifi solo funciona con redes de <b>2,4 GHz</b>. Si tu router tiene dos redes (por ejemplo «MiFibra» y «MiFibra-5G»), elige la que
            no pone 5G.
          </p>
          {bridge.scanWifi && (
            <button type="button" className="btn btn-block" disabled={scanning || phase === 'sending'} onClick={() => void scan()}>
              {scanning ? 'Buscando…' : 'Ver redes cercanas'}
            </button>
          )}
          {networks && (
            <div className="list" role="list">
              {networks.length === 0 && <div>No hemos encontrado redes. Escribe el nombre a mano.</div>}
              {networks.map((n) => (
                <button
                  key={`${n.ssid}-${n.frequency ?? ''}`}
                  type="button"
                  role="listitem"
                  disabled={is5GHz(n) || phase === 'sending'}
                  aria-pressed={ssid === n.ssid && !is5GHz(n)}
                  onClick={() => setSsid(n.ssid)}
                >
                  <b>{n.ssid}</b>
                  {is5GHz(n) ? (
                    <span className="muted small">5 GHz, no vale</span>
                  ) : ssid === n.ssid ? (
                    <span aria-hidden="true">✓</span>
                  ) : (
                    <span className="muted small">Elegir</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <Field label="Nombre de tu Wi-Fi" value={ssid} onChange={setSsid} hint="Tal cual aparece en el móvil, con mayúsculas." error={ssidError} />
          <Field
            label="Contraseña de tu Wi-Fi"
            type="password"
            value={password}
            onChange={setPassword}
            hint="La de tu router, no la de TermoZona."
            error={passError}
          />
          {error && <div className="notice error">{error}</div>}
          {phase === 'sending' ? (
            <>
              <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <p className="center muted">Enviando los datos al TermoWifi… {progress} %</p>
            </>
          ) : bridge.provisionWifi ? (
            <button
              type="button"
              className="btn btn-heat btn-block"
              disabled={!ssid.trim() || !!ssidError || !!passError}
              onClick={() => void send()}
            >
              Enviar al TermoWifi
            </button>
          ) : (
            <div className="notice warn">Este paso solo se puede hacer desde la app de Android.</div>
          )}
          {!password && ssid.trim() && phase === 'home' && <p className="small muted">¿Tu Wi-Fi no tiene contraseña? Puedes dejarla vacía.</p>}
        </>
      )}

      {phase === 'done' && (
        <>
          <h1>Datos enviados</h1>
          <div className="notice ok">
            El TermoWifi se está conectando a <b>«{ssid.trim()}»</b>. Cuando lo consiga, su luz Wi-Fi <b>dejará de parpadear</b>; suele tardar uno o
            dos minutos.
          </div>
          <p className="muted small">
            El móvil ha vuelto a tu Wi-Fi. Si no es así, conéctalo tú desde los ajustes. Si pasados unos minutos la luz sigue parpadeando, puede que la
            contraseña no fuera correcta: repite estos pasos.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => props.onDone(deviceSsid)}>
            Continuar
          </button>
          <button type="button" className="btn-link" onClick={() => go('blink')}>
            Repetir los pasos
          </button>
        </>
      )}
    </section>
  )
}

/** Schematic main panel with its Wi-Fi key blinking (not a picture of the real product). */
function PanelDrawing() {
  return (
    <div className="illustration panel-drawing" aria-hidden="true">
      <svg viewBox="0 0 240 150" fill="none">
        <rect x="50" y="12" width="140" height="126" rx="16" fill="var(--surface)" stroke="currentColor" strokeWidth="4" />
        <rect x="68" y="30" width="104" height="38" rx="6" fill="var(--surface-2)" />
        <circle cx="90" cy="102" r="12" stroke="currentColor" strokeWidth="3" opacity=".35" />
        <circle cx="150" cy="102" r="12" stroke="currentColor" strokeWidth="3" opacity=".35" />
        <g className="wifi-key">
          <circle cx="120" cy="102" r="20" className="wifi-glow" />
          <circle cx="120" cy="102" r="14" fill="var(--surface)" stroke="var(--heat)" strokeWidth="3" />
          <path d="M112 100a11 11 0 0 1 16 0M115.5 104a6 6 0 0 1 9 0" stroke="var(--heat)" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="120" cy="107.5" r="1.8" fill="var(--heat)" />
        </g>
        <path d="M150 124l-12-14m0 0 2 9m-2-9 9 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
      </svg>
    </div>
  )
}
