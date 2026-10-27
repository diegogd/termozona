import { useEffect, useRef, useState } from 'react'
import type { Bridge, WifiNetwork } from '../core/bridge'
import { Field } from './components'

/** Fixed password of the "Ing_XXXXXX" network a TermoWifi opens in setup mode. */
export const DEVICE_AP_PASSWORD = '1234567890'

/** Seconds the Wi-Fi key must be held to forget the saved network (Orkli manual and field tests). */
const RESET_SECONDS = 15

type Phase = 'light' | 'connected' | 'reset' | 'join' | 'home' | 'sending' | 'done'
const PHASES: Phase[] = ['light', 'join', 'home', 'done']
type Led = 'off' | 'blink' | 'on'

const is5GHz = (n: WifiNetwork) => (n.frequency ?? 0) > 4000
const byteLength = (s: string) => new TextEncoder().encode(s).length

/**
 * Connects a TermoWifi to the home Wi-Fi, following the Orkli manual: the blue
 * light of the Wi-Fi key is solid when connected, blinks when it has a network
 * saved but cannot reach it, and is off when it has none. Only with the light
 * off does it open its own "Ing_XXXXXX" network; holding the key ~15 s forgets
 * the saved network. The phone joins that network and the app sends the home
 * SSID and password. Used when signing up and from Ajustes.
 */
export function WifiSetup(props: { bridge: Bridge; onDone: (deviceSsid?: string) => void; onSkip?: () => void; skipLabel?: string }) {
  const { bridge } = props
  const [phase, setPhase] = useState<Phase>('light')
  const [error, setError] = useState<string>()
  const [tips, setTips] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  // joining the device network
  const [joining, setJoining] = useState(false)
  const [devices, setDevices] = useState<string[] | null>(null)
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

  useEffect(() => {
    if (countdown === null || countdown <= 0) return
    const t = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const go = (p: Phase) => {
    setError(undefined)
    setTips(false)
    setCountdown(null)
    setPhase(p)
  }

  /** The Wi-Fi the phone is on before switching is very likely the home one. */
  const rememberHome = async () => {
    const now = await bridge.currentWifi?.().catch(() => null)
    if (now && !now.startsWith('Ing_')) setSsid((s) => s || now)
  }

  const join = async (target?: string) => {
    if (!bridge.joinDeviceWifi) return setManual(true)
    setDevices(null)
    setJoining(true)
    setError(undefined)
    const r = await bridge.joinDeviceWifi(target)
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
        : 'No hemos podido conectar con el TermoWifi. Comprueba que la luz del botón Wi-Fi sigue apagada, o conéctate a mano como se explica abajo.',
    )
  }

  /** With several TermoWifi around (neighbours), the right one is on the back label. */
  const startJoin = async () => {
    go('join')
    await rememberHome()
    if (manual) return
    let nearby: string[] = []
    if (bridge.scanWifi) {
      setJoining(true)
      nearby = await bridge
        .scanWifi()
        .then((list) => [...new Set(list.map((n) => n.ssid).filter((n) => /^Ing_[0-9A-Za-z]{6}$/.test(n)))].sort())
        .catch(() => [])
      setJoining(false)
    }
    if (nearby.length > 1) setDevices(nearby)
    else await join(nearby[0])
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
        'El TermoWifi no responde. Comprueba que el móvil sigue conectado a su red (Ing_…) y que la luz del botón Wi-Fi sigue apagada. Si se ha encendido, vuelve a mantener el dedo 15 segundos y reintenta.',
      )
    }
  }

  const index = PHASES.indexOf(phase === 'sending' ? 'home' : phase === 'reset' || phase === 'connected' ? 'light' : phase)

  return (
    <section className="stack">
      <p className="small muted" aria-live="polite">
        Conectar a la Wi-Fi · {index + 1} de {PHASES.length}
      </p>

      {phase === 'light' && (
        <>
          <h1>¿Cómo está la luz del botón Wi-Fi?</h1>
          <PanelDrawing led="on" />
          <p>
            Mira el <b>termostato de pared con pantalla</b> (el TermoWifi). Abajo a la derecha tiene el botón Wi-Fi con una <b>luz azul</b>.
          </p>
          <div className="list" role="list">
            <button type="button" role="listitem" onClick={() => void startJoin()}>
              <span className="led-option">
                <i className="led led-off" aria-hidden="true" />
                <span>
                  <b>Apagada</b>
                  <br />
                  <span className="small muted">No tiene ninguna Wi-Fi guardada</span>
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            <button type="button" role="listitem" onClick={() => go('reset')}>
              <span className="led-option">
                <i className="led led-blink" aria-hidden="true" />
                <span>
                  <b>Parpadea</b>
                  <br />
                  <span className="small muted">Tiene una Wi-Fi guardada pero no consigue conectarse</span>
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            <button type="button" role="listitem" onClick={() => go('connected')}>
              <span className="led-option">
                <i className="led led-on" aria-hidden="true" />
                <span>
                  <b>Azul fija</b>
                  <br />
                  <span className="small muted">Ya está conectado a una Wi-Fi</span>
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </>
      )}

      {phase === 'connected' && (
        <>
          <h1>Tu TermoWifi ya está conectado</h1>
          <p>
            La luz azul fija indica que está conectado a una Wi-Fi. {props.onSkip ? 'Puedes seguir sin tocar nada.' : 'No hace falta cambiar nada.'}
          </p>
          {props.onSkip ? (
            <button type="button" className="btn btn-primary btn-block" onClick={props.onSkip}>
              {props.skipLabel ?? 'Continuar'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={() => props.onDone()}>
              Volver
            </button>
          )}
          <p className="muted small">¿Quieres conectarlo a otra Wi-Fi (por ejemplo, un router nuevo)? Primero hay que borrar la que tiene guardada.</p>
          <button type="button" className="btn btn-block" onClick={() => go('reset')}>
            Conectarlo a otra Wi-Fi
          </button>
        </>
      )}

      {phase === 'reset' && (
        <>
          <h1>Borra la Wi-Fi que tiene guardada</h1>
          <PanelDrawing led="blink" finger />
          <ol className="stack" style={{ margin: 0, paddingLeft: 22 }}>
            <li>
              Pon el dedo sobre el <b>botón Wi-Fi</b> y <b>mantenlo unos {RESET_SECONDS} segundos</b>, sin levantarlo.
            </li>
            <li>
              La luz hará un <b>parpadeo rápido</b> y se <b>apagará</b>. Entonces ya puedes soltar.
            </li>
          </ol>
          {countdown === null ? (
            <button type="button" className="btn btn-block" onClick={() => setCountdown(RESET_SECONDS)}>
              Cuéntame los {RESET_SECONDS} segundos
            </button>
          ) : (
            <p className="countdown center" role="timer" aria-live="polite">
              {countdown > 0 ? `${countdown} s` : 'Ya puedes soltar'}
            </p>
          )}
          <button type="button" className="btn btn-primary btn-block" onClick={() => void startJoin()}>
            La luz ya está apagada
          </button>
          <button type="button" className="btn-link" aria-expanded={tips} onClick={() => setTips(!tips)}>
            Sigue encendida o parpadeando
          </button>
          {tips && (
            <div className="notice info">
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Vuelve a probar contando {RESET_SECONDS} segundos enteros sin levantar el dedo: con solo unos segundos no se borra.</li>
                <li>Pulsa justo encima del dibujo de la Wi-Fi; es un botón táctil, no hace falta apretar fuerte.</li>
                <li>Comprueba que la pantalla del termostato está encendida.</li>
                <li>Si aun así no se apaga, consulta a tu instalador.</li>
              </ul>
            </div>
          )}
          <button type="button" className="btn-link" onClick={() => go('light')}>
            ← Volver
          </button>
        </>
      )}

      {phase === 'join' && (
        <>
          <h1>Conecta el móvil al TermoWifi</h1>
          {!manual && devices ? (
            <>
              <p>
                Hay varios TermoWifi cerca (seguramente de tus vecinos). Elige el tuyo: su código está en la <b>etiqueta de la parte trasera</b> del
                termostato.
              </p>
              <div className="list" role="list">
                {devices.map((d) => (
                  <button key={d} type="button" role="listitem" onClick={() => void join(d)}>
                    <b>{d}</b>
                    <span className="muted small">Elegir</span>
                  </button>
                ))}
              </div>
              <button type="button" className="btn-link" onClick={() => void join()}>
                El mío no está en la lista
              </button>
            </>
          ) : !manual ? (
            <>
              <p>
                Android te preguntará si quieres conectarte a una red que empieza por <b>Ing_</b>. Elige la tuya y pulsa <b>«Conectar»</b>.
              </p>
              <p className="muted small">
                Si aparecen varias, la tuya es la que coincide con el código de la etiqueta de la parte trasera del termostato.
              </p>
              <p className="muted small">Es solo un momento: al terminar, el móvil volverá solo a tu Wi-Fi.</p>
              {joining ? (
                <p className="center muted" role="status">
                  Buscando el TermoWifi…
                </p>
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={() => void startJoin()}>
                  Conectar con el TermoWifi
                </button>
              )}
            </>
          ) : (
            <>
              {error && <div className="notice warn">{error}</div>}
              <ol className="stack" style={{ margin: 0, paddingLeft: 22 }}>
                <li>
                  Abre los ajustes de Wi-Fi del móvil y elige la red que empieza por <b>Ing_</b>. Si hay varias, la tuya coincide con el código de
                  la etiqueta de la parte trasera del termostato.
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
                <button type="button" className="btn-link" onClick={() => (setManual(false), void startJoin())}>
                  Probar otra vez la conexión automática
                </button>
              )}
            </>
          )}
          <button type="button" className="btn-link" onClick={() => go('light')}>
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
            El TermoWifi se está conectando a <b>«{ssid.trim()}»</b>. Cuando lo consiga, la luz del botón Wi-Fi se quedará <b>azul fija</b>; suele
            tardar uno o dos minutos.
          </div>
          <p className="muted small">
            Si la luz <b>parpadea</b>, no ha podido conectarse: casi siempre es la contraseña o una red de 5 GHz. Mantén el dedo {RESET_SECONDS}{' '}
            segundos en el botón Wi-Fi para borrarla y repite estos pasos.
          </p>
          <p className="muted small">El móvil ha vuelto a tu Wi-Fi. Si no es así, conéctalo tú desde los ajustes.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={() => props.onDone(deviceSsid)}>
            Continuar
          </button>
          <button type="button" className="btn-link" onClick={() => go('light')}>
            Repetir los pasos
          </button>
        </>
      )}
    </section>
  )
}

/** Schematic TermoWifi wall unit (TW501B/TW502N) with its Wi-Fi key light. */
function PanelDrawing({ led, finger }: { led: Led; finger?: boolean }) {
  return (
    <div className="illustration panel-drawing" aria-hidden="true">
      <svg viewBox="0 0 240 200" fill="none">
        <rect x="68" y="8" width="104" height="184" rx="10" fill="#23262b" stroke="currentColor" strokeWidth="3" />
        <text x="120" y="62" textAnchor="middle" fontSize="40" fontWeight="700" fill="#e9ecef" opacity=".9" fontFamily="ui-monospace, monospace">
          21
        </text>
        <circle cx="90" cy="98" r="5" stroke="#adb5bd" strokeWidth="2" />
        <path d="M90 116v14m-6-10 12 6m0-6-12 6" stroke="#adb5bd" strokeWidth="2" strokeLinecap="round" />
        <path d="M150 92l-7 10h14zM143 120h14l-7 10z" stroke="#adb5bd" strokeWidth="2" strokeLinejoin="round" />
        <path d="M114 146a8 8 0 1 0 12 0M120 141v7" stroke="#adb5bd" strokeWidth="2" strokeLinecap="round" />
        <g>
          <circle cx="150" cy="160" r="5" className={`led-dot led-${led}`} />
          <path d="M142 176a11 11 0 0 1 16 0M145.5 180a6 6 0 0 1 9 0" stroke="#e9ecef" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="150" cy="184" r="1.6" fill="#e9ecef" />
        </g>
        {finger && (
          <g className="finger">
            <circle cx="150" cy="178" r="15" stroke="var(--heat)" strokeWidth="3" />
            <path d="M196 196l-30-14m0 0 8 9m-8-9 12-1" stroke="var(--heat)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
    </div>
  )
}
