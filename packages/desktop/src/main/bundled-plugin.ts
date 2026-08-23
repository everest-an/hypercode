import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { npmPackageDir } from "./engine-paths"
import { addRootArrayEntry, parseJsonc, rootKeys } from "./jsonc-edit"

// The orchestration plugin is a ~200 MB dependency tree. Installing it on demand means the user's first real
// prompt blocks for minutes behind an arborist run that reports no progress at all (`progress: false`,
// packages/core/src/npm.ts:86-93), which reads as a hung app. So the installer ships the tree and this module
// hands it to the engine before the engine ever asks for it.
//
// The handoff is the cache-hit branch of Npm.add (packages/core/src/npm.ts:125-127): if
// <cache>/packages/<spec>/node_modules/<name> already exists, Npm.add returns immediately and never touches
// the network. Seeding that path is the whole trick.

export const BUNDLED_PLUGIN_PACKAGE = "oh-my-openagent"

const VERSION_MARKER = ".hypercode-bundled-version"

// Npm.add keys its cache directory by the *spec string* it is handed, not by the package name
// (packages/core/src/npm.ts:79). The engine has two plugin loaders and they hand it different specs for this
// same package:
//   v1  packages/opencode/src/plugin/shared.ts:207-212 rewrites a bare name to "<name>@latest"
//   v2  packages/core/src/config/plugin/external.ts:77  passes the bare name straight through
// Both are reachable from the desktop server, so seeding one directory still leaves the other loader to
// download the identical tree. The second directory is cloned from the first — same volume by construction,
// so it costs hardlinks rather than another 200 MB.
const CACHE_SPECS = [`${BUNDLED_PLUGIN_PACKAGE}@latest`, BUNDLED_PLUGIN_PACKAGE]

// Same list and order as globalConfigFile() in packages/opencode/src/config/config.ts:139-147. First match
// wins; when nothing exists the engine would create the first entry, so we do too.
const CONFIG_CANDIDATES = ["hypercode.jsonc", "hypercode.json", "opencode.jsonc", "opencode.json", "config.json"]

// v1 config calls the list `plugin`, v2 calls it `plugins`, and a v1 document is migrated into v2 shape on
// read (packages/core/src/v1/config/migrate.ts:66). Writing `plugin` therefore reaches both loaders; writing
// `plugins` would only reach one. We still *read* both so an existing v2 document is not double-listed.
const PLUGIN_KEYS = ["plugin", "plugins"] as const

type Log = {
  log: (message: string, extra?: unknown) => void
  warn: (message: string, extra?: unknown) => void
}

export type SeedBundledPluginOptions = {
  /** Directory holding the staged install: `node_modules/`, `package.json`, `package-lock.json`. */
  source: string | undefined
  cacheDir: string
  configDir: string
  version: string
  log: Log
}

export type SeedBundledPluginResult = {
  seeded: string[]
  configured: boolean
}

/** Packaged builds get the payload from extraResources; an unpackaged run reads it straight out of the repo. */
export function resolveBundledPluginSource(input: { resourcesPath: string; appPath: string }) {
  const packaged = path.join(input.resourcesPath, "plugin")
  if (existsSync(packaged)) return packaged
  const repo = path.join(input.appPath, "resources", "plugin")
  return existsSync(repo) ? repo : undefined
}

export async function seedBundledPlugin(options: SeedBundledPluginOptions): Promise<SeedBundledPluginResult> {
  const result: SeedBundledPluginResult = { seeded: [], configured: false }
  const { source, log } = options
  // No payload is a supported state: local `bun dev` and any build made without the CI bundling step. The
  // engine then falls back to installing over the network, which is slow but still correct.
  if (!source) return result

  if (!existsSync(path.join(source, "node_modules", BUNDLED_PLUGIN_PACKAGE))) {
    log.warn("bundled plugin payload is incomplete", { source })
    return result
  }

  // Whichever directory we populate first becomes the clone source for the rest, so the expensive path (out
  // of the app bundle, possibly across volumes) is walked at most once.
  let clonedFrom = source
  for (const spec of CACHE_SPECS) {
    const target = npmPackageDir(options.cacheDir, spec)
    const installed = await fs.readFile(path.join(target, VERSION_MARKER), "utf8").catch(() => undefined)
    if (installed?.trim() === options.version && existsSync(path.join(target, "node_modules", BUNDLED_PLUGIN_PACKAGE)))
      continue

    // Build beside the real path and swap, so a crash or a full disk mid-clone cannot leave a half-populated
    // tree that Npm.add would happily treat as a cache hit. This runs before the engine sidecar starts, so
    // nothing is racing us for the directory.
    const staging = `${target}.incoming`
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    const cloned = await cloneTree(clonedFrom, staging)
      .then(() => true)
      .catch((error) => {
        log.warn("failed to stage bundled plugin", { spec, error })
        return false
      })
    if (!cloned) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
      continue
    }

    await fs.writeFile(path.join(staging, VERSION_MARKER), `${options.version}\n`, "utf8").catch(() => {})
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    const swapped = await fs
      .rename(staging, target)
      .then(() => true)
      .catch((error) => {
        log.warn("failed to install bundled plugin", { spec, error })
        return false
      })
    if (!swapped) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
      continue
    }
    result.seeded.push(spec)
    clonedFrom = target
  }

  // Only advertise the plugin once its tree is actually on disk. Listing it after a failed seed would hand
  // the user the exact multi-minute stall this module exists to remove.
  if (result.seeded.length > 0 || existsSync(path.join(npmPackageDir(options.cacheDir, CACHE_SPECS[0]), "node_modules")))
    result.configured = await ensurePluginConfigured(options.configDir, log)

  if (result.seeded.length > 0) log.log("seeded bundled plugin", { specs: result.seeded, configured: result.configured })
  return result
}

/**
 * Copy a tree, preferring hardlinks.
 *
 * A byte copy of ~200 MB across ~20k files is a visible first-launch stall on a spinning disk or a throttled
 * laptop, and "no waiting on first launch" is the entire requirement. Hardlinks turn it into metadata work
 * and consume no additional disk. They cannot cross volumes, so the first EXDEV/EPERM switches the rest of
 * the walk to real copies — that happens when the app runs from a mounted DMG, or sits on a different drive
 * than the user profile.
 */
async function cloneTree(from: string, to: string, state: { link: boolean } = { link: true }): Promise<void> {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await cloneTree(src, dest, state)
      continue
    }
    if (entry.isSymbolicLink()) {
      // npm trees contain symlinks (node_modules/.bin on POSIX, workspace links). Following them would
      // duplicate content and, for a link pointing outside the tree, copy the wrong thing entirely.
      const target = await fs.readlink(src)
      await fs.symlink(target, dest).catch(() => {})
      continue
    }
    if (state.link) {
      const linked = await fs
        .link(src, dest)
        .then(() => true)
        .catch(() => false)
      if (linked) continue
      state.link = false
    }
    await fs.copyFile(src, dest)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True when a config plugin list already mentions the package, in any of the three shapes it can take. */
function listsPackage(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const items: unknown[] = value
  return items.some((item) => {
    // "pkg" / "pkg@1.2.3"
    if (typeof item === "string") return matchesPackage(item)
    // v1 tuple form: ["pkg", { options }]
    if (Array.isArray(item)) {
      const first: unknown = item[0]
      return typeof first === "string" && matchesPackage(first)
    }
    // v2 object form: { package: "pkg", options: {} }
    if (isRecord(item)) return typeof item.package === "string" && matchesPackage(item.package)
    return false
  })
}

function matchesPackage(spec: string) {
  return spec === BUNDLED_PLUGIN_PACKAGE || spec.startsWith(`${BUNDLED_PLUGIN_PACKAGE}@`)
}

async function ensurePluginConfigured(dir: string, log: Log): Promise<boolean> {
  const existing = CONFIG_CANDIDATES.map((name) => path.join(dir, name)).find((file) => existsSync(file))
  const file = existing ?? path.join(dir, CONFIG_CANDIDATES[0])
  const text = existing ? await fs.readFile(file, "utf8").catch(() => undefined) : "{}"
  if (text === undefined) {
    log.warn("failed to read engine config", { file })
    return false
  }

  const parsed = parseJsonc(text)
  if (isRecord(parsed) && PLUGIN_KEYS.some((key) => listsPackage(parsed[key]))) return true

  // Extend whichever list the document already uses, so a v2 document does not get a stray v1 key bolted on
  // (which would change how the engine classifies and migrates it).
  const keys = rootKeys(text)
  const key = PLUGIN_KEYS.find((candidate) => keys.includes(candidate)) ?? PLUGIN_KEYS[0]
  const next = addRootArrayEntry(text, key, BUNDLED_PLUGIN_PACKAGE)
  if (next === undefined) {
    // Unparseable, or the key holds something that is not an array. Rewriting would destroy user data; the
    // plugin simply stays unlisted and everything else keeps working.
    log.warn("skipped engine config edit", { file, key })
    return false
  }

  await fs.mkdir(dir, { recursive: true }).catch(() => {})
  const temp = `${file}.incoming`
  const written = await fs
    .writeFile(temp, next, "utf8")
    .then(() => fs.rename(temp, file))
    .then(() => true)
    .catch(async (error) => {
      await fs.rm(temp, { force: true }).catch(() => {})
      log.warn("failed to write engine config", { file, error })
      return false
    })
  if (written) log.log("listed bundled plugin in engine config", { file, key })
  return written
}
