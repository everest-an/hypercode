import { isAppCompatible, isCompatible } from "./plugin-compat"
import { installPlugin, readInstalledPluginVersion, revertPlugin, type PluginManifest } from "./plugin-installer"

export type PluginUpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date"; version?: string }
  | { status: "available"; version: string }
  | { status: "incompatible"; version: string; reason: string }
  | { status: "installing"; version: string }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }

type Log = {
  log: (message: string, extra?: unknown) => void
  warn: (message: string, extra?: unknown) => void
}

export const PLUGIN_MANIFEST_URL =
  "https://github.com/AwareLiquid/HyperCode/releases/latest/download/plugin-manifest.json"

export function createPluginUpdaterController(input: {
  enabled: boolean
  appVersion: string
  cacheDir: string
  platform: string
  manifestUrl?: string
  fetch?: typeof fetch
  log?: Log
}) {
  const fetchImpl = input.fetch ?? fetch
  const manifestUrl = input.manifestUrl ?? PLUGIN_MANIFEST_URL
  let state: PluginUpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let candidate: PluginManifest | undefined
  let pending: Promise<PluginUpdaterState> | undefined
  const listeners = new Set<(state: PluginUpdaterState) => void>()

  const transition = (next: PluginUpdaterState) => {
    input.log?.log("plugin updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (pending) return pending
    pending = (async () => {
      transition({ status: "checking" })
      const response = await fetchImpl(manifestUrl, { headers: { accept: "application/json" } })
      if (response.status === 404) return transition({ status: "up-to-date" })
      if (!response.ok) throw new Error(`plugin manifest request failed: ${response.status}`)
      const manifest = (await response.json()) as PluginManifest
      if (manifest.schema !== 1 || manifest.plugin !== "oh-my-openagent" || !manifest.version)
        throw new Error("plugin manifest is invalid")
      if (!isAppCompatible(input.appVersion, manifest.compatibleApp.min, manifest.compatibleApp.maxExclusive)) {
        candidate = undefined
        return transition({
          status: "incompatible",
          version: manifest.version,
          reason: `requires app >=${manifest.compatibleApp.min} <${manifest.compatibleApp.maxExclusive}`,
        })
      }
      if (!isCompatible(manifest.version)) {
        candidate = undefined
        return transition({
          status: "incompatible",
          version: manifest.version,
          reason: "plugin version has not been validated",
        })
      }
      candidate = manifest
      const current = await readInstalledPluginVersion(input.cacheDir)
      if (current === manifest.version) return transition({ status: "up-to-date", version: current })
      return transition({ status: "available", version: manifest.version })
    })()
      .catch((error) =>
        transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  const install = async () => {
    if (!input.enabled) throw new Error("plugin updater is disabled")
    const manifest = candidate
    if (!manifest) throw new Error("no plugin update is available")
    transition({ status: "installing", version: manifest.version })
    try {
      await installPlugin({ cacheDir: input.cacheDir, manifest, platform: input.platform })
      return transition({ status: "ready", version: manifest.version })
    } catch (error) {
      transition({ status: "error", message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  const revert = async () => {
    await revertPlugin(input.cacheDir)
    candidate = undefined
    return transition({ status: "idle" })
  }

  return {
    getState: () => state,
    subscribe(listener: (state: PluginUpdaterState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    start: () => check(),
    check,
    install,
    revert,
  }
}

export type PluginUpdaterController = ReturnType<typeof createPluginUpdaterController>
