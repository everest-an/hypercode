import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { addRootObjectMember, hasRootObjectMember, parseJsonc, setRootString } from "./jsonc-edit"

// "One-click connect": the desktop app asks the site for a pairing code, opens the browser, and receives
// an API key when the user approves. The product rule is that a paying user never sees, copies or pastes a
// key — payment and account live on trust3.pro, compute comes back through its gateway, and this module is
// the only place the two meet.
//
// Two files get written, and they are deliberately different files:
//   config  — declares *where* to send requests (base URL, model ids). Not a secret.
//   auth    — holds the key, written 0600 by the engine itself too (packages/opencode/src/auth/index.ts).
// Keeping the secret out of the config matters: the config is a file users screenshot and share.

export const GATEWAY_PROVIDER_ID = "hypercode"
export const GATEWAY_BASE_URL = "https://api.trust3.pro/v1"
/** Site origin: serves the human-facing pages, including the /device approval page. */
export const GATEWAY_SITE = "https://www.trust3.pro"
/**
 * API origin. Deliberately NOT GATEWAY_SITE: the site is a static frontend (it answers 405 to a POST on
 * /api/v1/* — verified against production) while the Go backend lives on api.trust3.pro, which is also
 * where the deployed frontend points (`https://api.trust3.pro/api/v1` in its bundle). Pairing must talk
 * to the API origin; an earlier version sent these calls to the site and would have failed on deploy
 * while every test passed, because the fake server served both roles from one port.
 */
export const GATEWAY_API_BASE = "https://api.trust3.pro"

// Mirrors bake/templates/hypercode.json, which is what the CLI installer writes and what has actually been
// run end to end. Diverging here would mean the desktop and CLI paths talk to different models.
export const GATEWAY_MODELS: Record<string, string> = {
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-flash": "DeepSeek V4.1 Flash",
}

// Same list and order as globalConfigFile() in packages/opencode/src/config/config.ts and bundled-plugin.ts.
const CONFIG_CANDIDATES = ["hypercode.jsonc", "hypercode.json", "opencode.jsonc", "opencode.json", "config.json"]

const AUTH_FILE_MODE = 0o600

type Log = {
  log: (message: string, extra?: unknown) => void
  warn: (message: string, extra?: unknown) => void
}

/** The slice of `fetch` this module needs, so tests can hand it plain objects instead of a real network. */
export type HttpResponseLike = {
  status: number
  json: () => Promise<unknown>
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>

export type DeviceCode = {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type PairingOutcome =
  | { status: "approved"; apiKey: string }
  | { status: "expired" }
  | { status: "failed"; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Unwrap the API's `{ code, message, data }` envelope. Returns undefined unless code === 0. */
function envelopeData(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined
  if (payload.code !== 0) return undefined
  return payload.data
}

export function resolveDeviceCode(payload: unknown): DeviceCode | undefined {
  const data = envelopeData(payload)
  if (!isRecord(data)) return undefined
  const { device_code, user_code, verification_uri, expires_in, interval } = data
  if (typeof device_code !== "string" || device_code === "") return undefined
  if (typeof user_code !== "string" || user_code === "") return undefined
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: typeof verification_uri === "string" && verification_uri ? verification_uri : GATEWAY_SITE,
    expiresIn: typeof expires_in === "number" && expires_in > 0 ? expires_in : 600,
    interval: typeof interval === "number" && interval > 0 ? interval : 5,
  }
}

export function resolveTokenOutcome(payload: unknown): PairingOutcome {
  const data = envelopeData(payload)
  if (!isRecord(data)) return { status: "failed", reason: "unexpected response" }
  const status = data.status
  if (status === "approved") {
    const apiKey = data.api_key
    if (typeof apiKey !== "string" || apiKey === "") return { status: "failed", reason: "approval carried no key" }
    return { status: "approved", apiKey }
  }
  if (status === "expired") return { status: "expired" }
  // "pending" and anything unrecognised both mean "keep waiting" — the polling loop bounds itself by time.
  return { status: "failed", reason: `pending:${String(status)}` }
}

async function postJson(fetchImpl: FetchLike, url: string, body: unknown): Promise<unknown | undefined> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (response.status !== 200) return undefined
  return response.json().catch(() => undefined)
}

/** Ask the site for a pairing code. */
export async function requestDeviceCode(input: { fetchImpl: FetchLike; baseUrl?: string }): Promise<DeviceCode> {
  const base = input.baseUrl ?? GATEWAY_API_BASE
  const payload = await postJson(input.fetchImpl, `${base}/api/v1/hypercode/device/code`, {})
  const code = resolveDeviceCode(payload)
  if (!code) throw new Error("HyperCode pairing is unavailable right now")
  return code
}

/** One poll. `pending` is reported as a failure of the *poll*, not of the pairing — see waitForApproval. */
export async function pollDeviceToken(input: {
  fetchImpl: FetchLike
  deviceCode: string
  baseUrl?: string
}): Promise<PairingOutcome> {
  const base = input.baseUrl ?? GATEWAY_API_BASE
  const payload = await postJson(input.fetchImpl, `${base}/api/v1/hypercode/device/token`, {
    device_code: input.deviceCode,
  })
  return resolveTokenOutcome(payload)
}

/**
 * Poll until the user approves, the code expires, or the window closes.
 *
 * The deadline is enforced here rather than trusted to the server's `expires_in`, so a clock skew or a
 * forgotten timer can never leave a "connecting…" spinner running forever.
 */
export async function waitForApproval(input: {
  fetchImpl: FetchLike
  deviceCode: string
  baseUrl?: string
  intervalMs: number
  timeoutMs: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}): Promise<PairingOutcome> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = input.now ?? (() => Date.now())
  const deadline = now() + input.timeoutMs
  const interval = Math.max(input.intervalMs, 1_000)

  while (now() < deadline) {
    await sleep(interval)
    const outcome = await pollDeviceToken({
      fetchImpl: input.fetchImpl,
      deviceCode: input.deviceCode,
      baseUrl: input.baseUrl,
    })
    // "pending:..." is the not-yet case; anything else is terminal.
    if (outcome.status !== "failed" || !outcome.reason.startsWith("pending:")) return outcome
  }
  return { status: "expired" }
}

/** Merge the key into the engine's auth store, leaving every other provider's credential untouched. */
export async function writeGatewayCredential(input: {
  dataDir: string
  apiKey: string
  log: Log
}): Promise<boolean> {
  const file = path.join(input.dataDir, "auth.json")
  const existing = await fs.readFile(file, "utf8").catch(() => undefined)

  let data: Record<string, unknown> = {}
  if (existing !== undefined && existing.trim() !== "") {
    const parsed: unknown = (() => {
      try {
        return JSON.parse(existing)
      } catch {
        return undefined
      }
    })()
    // A file we cannot understand is a file we must not overwrite: it may hold the user's other logins.
    if (!isRecord(parsed)) {
      input.log.warn("refused to rewrite an unreadable auth store", { file })
      return false
    }
    data = parsed
  }

  data[GATEWAY_PROVIDER_ID] = { type: "api", key: input.apiKey }

  await fs.mkdir(input.dataDir, { recursive: true }).catch(() => {})
  const temp = `${file}.incoming`
  return fs
    .writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: AUTH_FILE_MODE })
    .then(() => fs.rename(temp, file))
    .then(() => true)
    .catch(async (error) => {
      await fs.rm(temp, { force: true }).catch(() => {})
      input.log.warn("failed to write gateway credential", { file, error })
      return false
    })
}

/**
 * Declare the gateway provider in the engine config, without touching anything the user wrote.
 *
 * No `apiKey` field is written on purpose. An `options.apiKey` — even an empty string, which is what an
 * older installer seeded — shadows the auth store, so leaving the field absent is what lets the credential
 * we just stored be the one the engine actually uses.
 */
export async function ensureGatewayProvider(input: { configDir: string; log: Log }): Promise<boolean> {
  const existing = CONFIG_CANDIDATES.map((name) => path.join(input.configDir, name)).find((file) =>
    existsSync(file),
  )
  const file = existing ?? path.join(input.configDir, CONFIG_CANDIDATES[0])
  const text = existing ? await fs.readFile(file, "utf8").catch(() => undefined) : "{}"
  if (text === undefined) {
    input.log.warn("failed to read engine config", { file })
    return false
  }

  let next = text
  if (!hasRootObjectMember(next, "provider", GATEWAY_PROVIDER_ID)) {
    // Each model maps to an object with a `name`, exactly as the CLI installer writes it - a bare string
    // here would diverge from the only configuration that has actually been run end to end.
    const models = Object.entries(GATEWAY_MODELS)
      .map(([id, name]) => `${JSON.stringify(id)}: { "name": ${JSON.stringify(name)} }`)
      .join(", ")
    const block = `{
      "npm": "@ai-sdk/openai-compatible",
      "name": "HyperCode",
      "options": { "baseURL": ${JSON.stringify(GATEWAY_BASE_URL)} },
      "models": { ${models} }
    }`
    const added = addRootObjectMember(next, "provider", GATEWAY_PROVIDER_ID, block)
    if (added === undefined) {
      // Unparseable, or `provider` holds a shape we do not understand. Rewriting would destroy user data,
      // and the credential is already stored - the user can still point the engine at the gateway by hand.
      input.log.warn("skipped engine config edit", { file, provider: GATEWAY_PROVIDER_ID })
      return false
    }
    next = added
  }

  // Pairing means "use the gateway": a DeepSeek-era default (or no model at all) moves to the gateway model.
  // A model the user picked from another provider is left alone.
  const current = parseJsonc(next)
  const model = isRecord(current) ? current.model : undefined
  if (typeof model === "string" && model.startsWith("deepseek/")) {
    const switched = setRootString(next, "model", `${GATEWAY_PROVIDER_ID}/deepseek-v4-pro`)
    if (switched !== undefined) next = switched
  }

  const reparsed = parseJsonc(next)
  if (!isRecord(reparsed)) {
    input.log.warn("refused to write an engine config that no longer parses", { file })
    return false
  }

  await fs.mkdir(input.configDir, { recursive: true }).catch(() => {})
  const temp = `${file}.incoming`
  const written = await fs
    .writeFile(temp, next, "utf8")
    .then(() => fs.rename(temp, file))
    .then(() => true)
    .catch(async (error) => {
      await fs.rm(temp, { force: true }).catch(() => {})
      input.log.warn("failed to write engine config", { file, error })
      return false
    })
  if (written) input.log.log("declared gateway provider in engine config", { file })
  return written
}

export type ConnectResult =
  | { status: "connected" }
  | { status: "expired" }
  | { status: "cancelled"; reason: string }

export type ConnectInput = {
  fetchImpl: FetchLike
  configDir: string
  dataDir: string
  /** Opens the pairing page. Injected so tests never launch a browser. */
  openExternal: (url: string) => Promise<unknown>
  /** Progress channel: the renderer shows the code the user has to compare in the browser. */
  onCode?: (code: DeviceCode) => void
  baseUrl?: string
  log: Log
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/**
 * The whole flow: request a code, send the user to the approval page, wait, then store what comes back.
 *
 * Failure at the storage step is reported as `cancelled` rather than thrown: the user's part (approving in
 * the browser) succeeded, so the UI should say "connected, but the key could not be saved" instead of
 * offering a retry that would mint yet another key.
 */
export async function connectGateway(input: ConnectInput): Promise<ConnectResult> {
  const code = await requestDeviceCode({ fetchImpl: input.fetchImpl, baseUrl: input.baseUrl })
  input.onCode?.(code)

  await input.openExternal(code.verificationUri).catch((error) => {
    input.log.warn("failed to open the approval page", error)
  })

  const outcome = await waitForApproval({
    fetchImpl: input.fetchImpl,
    deviceCode: code.deviceCode,
    baseUrl: input.baseUrl,
    intervalMs: code.interval * 1_000,
    timeoutMs: code.expiresIn * 1_000,
    sleep: input.sleep,
    now: input.now,
  })
  if (outcome.status !== "approved") {
    return outcome.status === "expired" ? { status: "expired" } : { status: "cancelled", reason: outcome.reason }
  }

  const provider = await ensureGatewayProvider({ configDir: input.configDir, log: input.log })
  const credential = await writeGatewayCredential({
    dataDir: input.dataDir,
    apiKey: outcome.apiKey,
    log: input.log,
  })
  if (!provider || !credential) {
    return { status: "cancelled", reason: provider ? "credential-not-saved" : "provider-not-saved" }
  }
  input.log.log("gateway connected", { provider: GATEWAY_PROVIDER_ID })
  return { status: "connected" }
}


/**
 * Whether the gateway currently serves the stored key.
 *
 * The gateway answers /v1/models with 403 while the account has no balance, so this is also the payment
 * check the app polls after opening the purchase page - no separate billing endpoint is needed.
 */
export type GatewayBalance =
  | { status: "funded" }
  | { status: "unfunded" }
  | { status: "unconfigured" }
  | { status: "unreachable" }

export async function checkGatewayBalance(input: {
  dataDir: string
  fetchImpl: FetchLike
  baseUrl?: string
}): Promise<GatewayBalance> {
  const file = path.join(input.dataDir, "auth.json")
  const raw = await fs.readFile(file, "utf8").catch(() => undefined)
  if (!raw) return { status: "unconfigured" }
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (!isRecord(parsed)) return { status: "unconfigured" }
  const entry = parsed[GATEWAY_PROVIDER_ID]
  const key = isRecord(entry) && typeof entry.key === "string" ? entry.key : undefined
  if (!key) return { status: "unconfigured" }
  const response = await input
    .fetchImpl(`${input.baseUrl ?? GATEWAY_BASE_URL}/models`, { headers: { authorization: `Bearer ${key}` } })
    .catch(() => undefined)
  if (!response) return { status: "unreachable" }
  if (response.status === 200) return { status: "funded" }
  if (response.status === 403) return { status: "unfunded" }
  return { status: "unreachable" }
}