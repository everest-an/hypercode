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

export type PluginUpdaterPlatform = {
  state: () => PluginUpdaterState
  check(): Promise<PluginUpdaterState>
  install(): Promise<PluginUpdaterState>
  revert(): Promise<PluginUpdaterState>
}
