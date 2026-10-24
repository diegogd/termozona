import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  // Relative paths so the build works inside the Android WebView.
  base: './',
  plugins: [react()],
  define: {
    // The release workflow sets VERSION_NAME from the git tag.
    __APP_VERSION__: JSON.stringify(process.env.VERSION_NAME ?? `${pkg.version}-dev`),
  },
})
