// Checks GitHub Releases for a newer APK. The app is not in Google Play, so
// this is how neighbours find out about new versions.

import type { Bridge } from './bridge'

export const RELEASES_REPO = 'diegogd/termozona'
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases/latest`

export interface UpdateInfo {
  version: string
  /** Direct APK download, or the release page if the APK is not attached. */
  url: string
  notes: string
}

/** Compares "1.2.3" style versions; a leading "v" is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0)
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export async function checkForUpdate(bridge: Bridge, current: string): Promise<UpdateInfo | undefined> {
  if (bridge.kind !== 'native' || current.includes('dev')) return undefined
  try {
    const res = await bridge.httpGet(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TermoZona',
    })
    if (res.status !== 200) return undefined
    const release = JSON.parse(new TextDecoder().decode(res.body)) as {
      tag_name: string
      html_url: string
      body?: string
      assets?: { name: string; browser_download_url: string }[]
    }
    if (!isNewer(release.tag_name, current)) return undefined
    const apk = release.assets?.find((a) => a.name.endsWith('.apk'))
    return { version: release.tag_name.replace(/^v/, ''), url: apk?.browser_download_url ?? release.html_url, notes: release.body ?? '' }
  } catch {
    return undefined
  }
}
