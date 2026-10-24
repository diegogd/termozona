// Instal.dat: the project file the original app generates for a TermoWifi.
// Each object is 8 lines: plan, name, x, y, ?, output (zone 0..7), type, icon.
// Type 49 is a thermostat zone; output 9 is the optional ventilation unit.

export interface ZoneInfo {
  index: number
  name: string
}

const THERMOSTAT_TYPE = '49'

export function parseInstal(text: string): ZoneInfo[] {
  const lines = text.split(/\r?\n/)
  const zones: ZoneInfo[] = []
  for (let i = 0; i + 7 < lines.length; i += 8) {
    const name = lines[i + 1].trim()
    const output = Number.parseInt(lines[i + 5], 10)
    if (lines[i + 6].trim() !== THERMOSTAT_TYPE || Number.isNaN(output) || output > 7) continue
    zones.push({ index: output, name: name || `Zona ${output + 1}` })
  }
  return zones.sort((a, b) => a.index - b.index)
}

/** Builds Instal.dat the same way ConfigureTermowifiUserActivity.generateFile() does. */
export function buildInstal(zones: ZoneInfo[]): string {
  return zones
    .map((z, i) => `0\n${z.name}\n${i % 2}\n${Math.floor(i / 2)}\n1\n${z.index}\n49\n11\n`)
    .join('')
}

/** "Ing_A1B2C3" or "A1B2C3" or "WA1B2C3" -> "WA1B2C3", or undefined if invalid. */
export function deviceIdFromInput(input: string): string | undefined {
  const s = input.trim().toUpperCase().replace(/^ING_/, '').replace(/^W(?=[0-9A-Z]{6}$)/, '')
  return /^[0-9A-Z]{6}$/.test(s) ? `W${s}` : undefined
}

/** Clean zone name for Instal.dat (one line, reasonable length). */
export const cleanZoneName = (name: string): string => name.replace(/[\r\n]+/g, ' ').trim().slice(0, 30)

/** Renames a zone in an existing Instal.dat, keeping every other line as it was. */
export function renameInInstal(text: string, index: number, name: string): string | undefined {
  const lines = text.split('\n')
  for (let i = 0; i + 7 < lines.length; i += 8) {
    if (lines[i + 6].trim() === THERMOSTAT_TYPE && Number.parseInt(lines[i + 5], 10) === index) {
      lines[i + 1] = cleanZoneName(name)
      return lines.join('\n')
    }
  }
  return undefined
}
