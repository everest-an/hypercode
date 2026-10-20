import fs from "node:fs/promises"
import path from "node:path"

export type PluginState = {
  activeVersion: string
  source: "bundled" | "npm"
  previousVersion?: string
  specs: string[]
  installedAt: string
  pendingValidation?: boolean
}

const STATE_FILE = ".hypercode-plugin-state.json"

export function pluginStatePath(cacheDir: string) {
  return path.join(cacheDir, "packages", STATE_FILE)
}

export async function readPluginState(cacheDir: string): Promise<PluginState | undefined> {
  const raw = await fs.readFile(pluginStatePath(cacheDir), "utf8").catch(() => undefined)
  if (!raw) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  return isPluginState(value) ? value : undefined
}

function isPluginState(value: unknown): value is PluginState {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.activeVersion !== "string") return false
  if (record.source !== "bundled" && record.source !== "npm") return false
  if (!Array.isArray(record.specs) || !record.specs.every((spec) => typeof spec === "string")) return false
  if (typeof record.installedAt !== "string") return false
  if (record.previousVersion !== undefined && typeof record.previousVersion !== "string") return false
  if (record.pendingValidation !== undefined && typeof record.pendingValidation !== "boolean") return false
  return true
}

export async function writePluginState(cacheDir: string, state: PluginState): Promise<void> {
  const file = pluginStatePath(cacheDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.incoming`
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await fs.rename(temp, file)
}

export async function clearPluginState(cacheDir: string): Promise<void> {
  await fs.rm(pluginStatePath(cacheDir), { force: true })
}
