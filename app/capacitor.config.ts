import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'es.termozona.app',
  appName: 'TermoZona',
  webDir: 'dist',
  android: {
    // The UI talks to the cloud only through the native OrkliNet plugin.
    allowMixedContent: false,
  },
}

export default config
