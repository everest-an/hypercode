export type PluginCompat = {
  package: string
  min: string
  maxExclusive: string
  tested: string[]
}

export const PLUGIN_COMPAT: PluginCompat = {
  package: "oh-my-openagent",
  min: "4.19.4",
  maxExclusive: "6.0.0",
  tested: ["4.19.4", "5.1.34"],
}

type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) throw new Error(`invalid version: ${!a ? left : right}`)

  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (b.prerelease.length === 0 && a.prerelease.length > 0) return -1

  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isNaN(nx) || Number.isNaN(ny)) {
      if (x !== y) return x < y ? -1 : 1
      continue
    }
    if (nx !== ny) return nx < ny ? -1 : 1
  }
  return 0
}

export function isCompatible(version: string, compat: PluginCompat = PLUGIN_COMPAT): boolean {
  if (!parseVersion(version)) return false
  if (!compat.tested.includes(version)) return false
  return compareVersions(version, compat.min) >= 0 && compareVersions(version, compat.maxExclusive) < 0
}

export function resolveCandidate(
  latest: string | undefined,
  compat: PluginCompat = PLUGIN_COMPAT,
): string | undefined {
  if (!latest || !isCompatible(latest, compat)) return undefined
  return latest
}

export function isAppCompatible(appVersion: string, min: string, maxExclusive: string): boolean {
  if (!parseVersion(appVersion) || !parseVersion(min) || !parseVersion(maxExclusive)) return false
  return compareVersions(appVersion, min) >= 0 && compareVersions(appVersion, maxExclusive) < 0
}
