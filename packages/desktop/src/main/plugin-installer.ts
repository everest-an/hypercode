import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"

import { npmPackageDir, sanitizeNpmSpec } from "./engine-paths"
import { clearPluginState, readPluginState, writePluginState, type PluginState } from "./plugin-state"

export const PLUGIN_NAME = "oh-my-openagent"
export const PLUGIN_SPECS = [`${PLUGIN_NAME}@latest`, PLUGIN_NAME] as const

export type PluginAsset = {
  file: string
  sha256: string
  url: string
}

export type PluginManifest = {
  schema: 1
  plugin: string
  version: string
  compatibleApp: { min: string; maxExclusive: string }
  assets: Record<string, PluginAsset>
}

export type InstallerDeps = {
  fetch: typeof fetch
  extract: (bytes: Uint8Array, dest: string) => Promise<void>
}

type Journal = {
  version: string
  previous?: string
  specs: string[]
  backups: Record<string, string>
  created: string[]
}

const JOURNAL_FILE = ".hypercode-plugin-txn.json"
const PAYLOAD_MODULES_DIR = "modules"

function journalPath(cacheDir: string) {
  return path.join(cacheDir, "packages", JOURNAL_FILE)
}

function backupDir(cacheDir: string, previous: string | undefined) {
  return path.join(cacheDir, "packages", ".backup", previous ?? "bundled")
}

export async function readInstalledPluginVersion(cacheDir: string): Promise<string | undefined> {
  for (const spec of PLUGIN_SPECS) {
    const manifest = path.join(npmPackageDir(cacheDir, spec), "node_modules", PLUGIN_NAME, "package.json")
    const raw = await fs.readFile(manifest, "utf8").catch(() => undefined)
    if (!raw) continue
    try {
      const version: unknown = JSON.parse(raw).version
      if (typeof version === "string") return version
    } catch {}
  }
  return undefined
}

export async function installPlugin(input: {
  cacheDir: string
  manifest: PluginManifest
  platform: string
  deps?: Partial<InstallerDeps>
}): Promise<PluginState> {
  const deps: InstallerDeps = {
    fetch: input.deps?.fetch ?? fetch,
    extract: input.deps?.extract ?? extractZip,
  }
  const asset = input.manifest.assets[input.platform]
  if (!asset) throw new Error(`no plugin payload for ${input.platform}`)

  const response = await deps.fetch(asset.url)
  if (!response.ok) throw new Error(`plugin download failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex")
  if (digest !== asset.sha256) throw new Error("plugin payload checksum mismatch")

  await recoverPluginTransaction(input.cacheDir)

  const current = await readPluginState(input.cacheDir)
  const previous = current?.activeVersion ?? (await readInstalledPluginVersion(input.cacheDir))
  const staging = path.join(input.cacheDir, "packages", ".staging", `${input.manifest.version}-${Date.now()}`)
  await fs.rm(staging, { recursive: true, force: true })
  await deps.extract(bytes, staging)

  const modules = path.join(staging, PAYLOAD_MODULES_DIR)
  const installed = await readVersion(path.join(modules, PLUGIN_NAME, "package.json"))
  if (installed !== input.manifest.version)
    throw new Error(`plugin payload is ${String(installed)}, expected ${input.manifest.version}`)

  const journal: Journal = {
    version: input.manifest.version,
    previous,
    specs: [...PLUGIN_SPECS],
    backups: {},
    created: [],
  }
  await writeJournal(input.cacheDir, journal)

  try {
    for (const spec of PLUGIN_SPECS) {
      const staged = path.join(staging, "specs", sanitizeNpmSpec(spec))
      await cloneTree(modules, path.join(staged, "node_modules"))
      const target = npmPackageDir(input.cacheDir, spec)
      if (await exists(target)) {
        const backup = path.join(backupDir(input.cacheDir, previous), sanitizeNpmSpec(spec))
        await fs.rm(backup, { recursive: true, force: true })
        await fs.mkdir(path.dirname(backup), { recursive: true })
        await fs.rename(target, backup)
        journal.backups[spec] = backup
      } else {
        journal.created.push(spec)
      }
      await writeJournal(input.cacheDir, journal)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rename(staged, target)
    }
  } catch (error) {
    await recoverPluginTransaction(input.cacheDir)
    await fs.rm(staging, { recursive: true, force: true })
    throw error
  }

  const state: PluginState = {
    activeVersion: input.manifest.version,
    source: "npm",
    previousVersion: previous,
    specs: [...PLUGIN_SPECS],
    installedAt: new Date().toISOString(),
    pendingValidation: true,
  }
  await writePluginState(input.cacheDir, state)
  await fs.rm(journalPath(input.cacheDir), { force: true })
  await fs.rm(staging, { recursive: true, force: true })
  return state
}

export async function recoverPluginTransaction(cacheDir: string): Promise<void> {
  const raw = await fs.readFile(journalPath(cacheDir), "utf8").catch(() => undefined)
  if (!raw) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    await fs.rm(journalPath(cacheDir), { force: true })
    return
  }
  if (!isJournal(parsed)) {
    await fs.rm(journalPath(cacheDir), { force: true })
    return
  }
  const journal = parsed
  for (const spec of journal.specs) {
    const target = npmPackageDir(cacheDir, spec)
    const backup = journal.backups[spec]
    if (backup && (await exists(backup))) {
      await fs.rm(target, { recursive: true, force: true })
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rename(backup, target)
      continue
    }
    if (journal.created.includes(spec)) await fs.rm(target, { recursive: true, force: true })
  }
  await fs.rm(journalPath(cacheDir), { force: true })
}

export async function revertPlugin(cacheDir: string): Promise<void> {
  await recoverPluginTransaction(cacheDir)
  for (const spec of PLUGIN_SPECS) await fs.rm(npmPackageDir(cacheDir, spec), { recursive: true, force: true })
  await fs.rm(path.join(cacheDir, "packages", ".backup"), { recursive: true, force: true })
  await clearPluginState(cacheDir)
}

export async function markPluginValidated(cacheDir: string): Promise<void> {
  const state = await readPluginState(cacheDir)
  if (!state || !state.pendingValidation) return
  await writePluginState(cacheDir, { ...state, pendingValidation: false })
}

function isJournal(value: unknown): value is Journal {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.version === "string" &&
    Array.isArray(record.specs) &&
    record.specs.every((spec) => typeof spec === "string") &&
    typeof record.backups === "object" &&
    record.backups !== null &&
    Array.isArray(record.created) &&
    record.created.every((spec) => typeof spec === "string")
  )
}

async function readVersion(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")).version
  } catch {
    return undefined
  }
}

async function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    () => false,
  )
}

async function writeJournal(cacheDir: string, journal: Journal) {
  const file = journalPath(cacheDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.incoming`
  await fs.writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, "utf8")
  await fs.rename(temp, file)
}

async function cloneTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) {
      await cloneTree(src, dest)
      continue
    }
    if (entry.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(src), dest).catch(() => {})
      continue
    }
    const linked = await fs.link(src, dest).then(
      () => true,
      () => false,
    )
    if (!linked) await fs.copyFile(src, dest)
  }
}

export async function extractZip(bytes: Uint8Array, dest: string): Promise<void> {
  const reader = new ZipReader(new BlobReader(new Blob([bytes.slice()])))
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !entry.getData) continue
      const root = path.resolve(dest)
      const target = path.resolve(dest, entry.filename)
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error("zip entry escapes destination")
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, await entry.getData(new Uint8ArrayWriter()))
    }
  } finally {
    await reader.close()
  }
}
