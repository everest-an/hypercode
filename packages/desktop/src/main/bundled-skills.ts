import { app } from "electron"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { configDir } from "./engine-paths"
import { fingerprintTree } from "./payload-fingerprint"

// The bake scripts install the skill library during the CLI setup flow. Desktop users never run those, so
// without this the finance/legal/academic skills the product is sold on would not exist for them.
//
// Layout and namespacing intentionally mirror bake.sh: each source group lands at
// <config>/skills/hypercode-<group>/ so the "hypercode-" prefix marks the system-managed zone. Anything the
// user creates outside that prefix is never touched.

const NAMESPACE_PREFIX = "hypercode-"
const VERSION_MARKER = ".hypercode-bundled-version"

function sourceDir() {
  // Packaged: extraResources puts the library at <resources>/skills. Unpackaged: fall back to the repo copy
  // so `bun dev` behaves like a real install.
  const packaged = path.join(process.resourcesPath, "skills")
  if (existsSync(packaged)) return packaged
  const repo = path.resolve(app.getAppPath(), "..", "..", "..", "bake", "skills")
  return existsSync(repo) ? repo : undefined
}

export async function installBundledSkills(
  log: {
    log: (message: string, extra?: unknown) => void
    warn: (message: string, extra?: unknown) => void
  },
  /** Reports group counts so the window can show real progress. Unlike the plugin, the total is known here. */
  onProgress?: (done: number, total: number) => void,
) {
  const source = sourceDir()
  if (!source) return

  const dest = path.join(configDir(), "skills")
  const marker = path.join(dest, VERSION_MARKER)
  const version = app.getVersion()

  // Two stages, because the two cheap answers are cheap for different reasons.
  //
  // Keying this on the app version alone meant every update recopied ~44 MB that had not changed — 7 of the
  // 50 seconds a user spent on the "Could not reach Local Server" screen after upgrading 0.1.8 to 0.1.9. But
  // fingerprinting the payload on every launch is not free either: 1223 files cost ~650 ms, which would be
  // added to the ordinary launch that today takes 4 s and needs to do nothing at all.
  //
  // So: the app version is the fast path and answers the common case for nothing. The fingerprint only runs
  // when that misses, which is once per update, and decides whether the copy is actually needed.
  const installed = await fs.readFile(marker, "utf8").catch(() => undefined)
  const [installedVersion, installedFingerprint] = (installed ?? "").trim().split("|")
  if (installedVersion === version) return

  const fingerprint = await fingerprintTree(source)
  if (installedFingerprint && fingerprint && installedFingerprint === fingerprint) {
    // Same payload under a new app version. Restamp so the next launch takes the fast path again.
    await fs.writeFile(marker, `${version}|${fingerprint}\n`, "utf8").catch(() => {})
    log.log("bundled skills already current", { dest })
    return
  }

  const groups = await fs.readdir(source, { withFileTypes: true }).catch(() => [])
  const dirs = groups.filter((entry) => entry.isDirectory())
  if (dirs.length === 0) return

  await fs.mkdir(dest, { recursive: true })
  let count = 0
  // Announced only once we know a copy is actually needed — the early returns above are the common case and
  // must not flash a progress screen on an ordinary launch.
  onProgress?.(0, dirs.length)
  for (const entry of dirs) {
    const target = path.join(dest, `${NAMESPACE_PREFIX}${entry.name}`)
    // Replace the system-managed namespace wholesale rather than merging, so a skill removed upstream does
    // not linger. Write to a sibling first and swap, so an interrupted copy cannot leave a half-written
    // namespace that the engine would then try to load.
    const staging = `${target}.incoming`
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    const copied = await fs
      .cp(path.join(source, entry.name), staging, { recursive: true })
      .then(() => true)
      .catch((error) => {
        log.warn("failed to stage bundled skills", { group: entry.name, error })
        return false
      })
    if (!copied) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
      continue
    }
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    const swapped = await fs
      .rename(staging, target)
      .then(() => true)
      .catch((error) => {
        log.warn("failed to install bundled skills", { group: entry.name, error })
        return false
      })
    if (swapped) count++
    else await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    onProgress?.(count, dirs.length)
  }

  if (count === 0) return
  await fs.writeFile(marker, `${version}|${fingerprint}\n`, "utf8").catch((error) => {
    // Losing the marker only costs a redundant copy next launch; the skills themselves are in place.
    log.warn("failed to record bundled skill version", error)
  })
  log.log("installed bundled skills", { groups: count, dest })
}
