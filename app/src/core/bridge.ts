// Network primitives the cloud client needs. Browsers cannot open raw TLS
// sockets or speak FTP, so each platform provides its own implementation:
//   - native/capacitorBridge.ts: Android plugin (direct to the Orkli cloud)
//   - demo/demoBridge.ts:        in-memory simulation for the browser and tests
//   - a future proxy bridge:     WebSocket to an intermediate server (PWA/iOS)

export interface HttpResponse {
  status: number
  /** Lower-case header names. */
  headers: Record<string, string>
  body: Uint8Array
}

export interface SocketHandle {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface SocketListener {
  onData(data: Uint8Array): void
  onClose(reason?: string): void
}

export interface FtpFile {
  name: string
  data: Uint8Array
}

export interface WifiNetwork {
  ssid: string
  level?: number
}

export interface Bridge {
  readonly kind: 'native' | 'demo' | 'proxy'
  httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse>
  /** TLS socket with normal certificate and host name verification. */
  openSocket(host: string, port: number, listener: SocketListener): Promise<SocketHandle>
  ftpStore(host: string, user: string, password: string, files: FtpFile[]): Promise<void>
  ftpRetrieve(host: string, user: string, password: string, name: string): Promise<Uint8Array | null>
  /** Optional: list nearby Wi-Fi networks (used to find "Ing_XXXXXX" devices). */
  scanWifi?(): Promise<WifiNetwork[]>
  /** Optional: send home Wi-Fi credentials to a TermoWifi in access-point mode. */
  provisionWifi?(ssid: string, password: string, onProgress: (pct: number) => void): Promise<void>
}

export class NetworkError extends Error {
  readonly code: 'offline' | 'timeout' | 'tls' | 'refused' | 'unknown'

  constructor(message: string, code: NetworkError['code'] = 'unknown') {
    super(message)
    this.name = 'NetworkError'
    this.code = code
  }
}
