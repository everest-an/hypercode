import { app } from "electron"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// The bake scripts install the skill library during the CLI setup flow. Desktop users never run those, so
// without this the finance/legal/academic skills the product is sold on would not exist for them.
//
// Layout and namespacing intentionally mirror bake.sh: each source group lands at
// <config>/skills/hypercode-<group>/ so the "hypercode-" prefix marks the system-managed zone. Anything the
// user creates outside that prefix is never touched.

const NAMESPACE_PREFIX = "hypercode-"
const VERSION_MARKER = ".hypercode-bundled-version"

// Must resolve to the same directory the engine reads. `xdg-basedir` has no platform branch, so this is
// ~/.config/hypercode on Windows and macOS too, not %APPDATA% or ~/Library/Preferences.
function configDir() {
  const override = process.env["OPENCODE_CONFIG_DIR"]
  if (override) return override
  const xdg = process.env["XDG_CONFIG_HOME"]
  if (xdg) return path.join(xdg, "hypercode")
  return path.join(os.homedir(), ".config", "hypercode")
}

function sourceDir() {
  // Packaged: extraResources puts the library at <resources>/skills. Unpackaged: fall back to the repo copy
  // so `bun dev` behaves like a real install.
  const packaged = path.join(process.resourcesPath, "skills")
  if (existsSync(packaged)) return packaged
  const repo = path.resolve(app.getAppPath(), "..", "..", "..", "bake", "skills")
  return existsSync(repo) ? repo : undefined
}

export async function installBundledSkills(log: {
  log: (message: string, extra?: unknown) => void
  warn: (message: string, extra?: unknown) => void
}) {
  const source = sourceDir()
  if (!source) return

  const dest = path.join(configDir(), "skills")
  const marker = path.join(dest, VERSION_MARKER)
  const version = app.getVersion()

  // Copying ~44 MB on every launch would be a visible startup cost, so only redo it when the app version
  // changes. A user who deletes the marker gets a clean reinstall of the system zone.
  const installed = await fs.readFile(marker, "utf8").catch(() => undefined)
  if (installed?.trim() === version) return

  const groups = await fs.readdir(source, { withFileTypes: true }).catch(() => [])
  const dirs = groups.filter((entry) => entry.isDirectory())
  if (dirs.length === 0) return

  await fs.mkdir(dest, { recursive: true })
  let count = 0
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
  }

  if (count === 0) return
  await fs.writeFile(marker, `${version}\n`, "utf8").catch((error) => {
    // Losing the marker only costs a redundant copy next launch; the skills themselves are in place.
    log.warn("failed to record bundled skill version", error)
  })
  log.log("installed bundled skills", { groups: count, dest })
}
