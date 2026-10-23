import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GATEWAY_API_BASE,
  GATEWAY_BASE_URL,
  GATEWAY_PROVIDER_ID,
  GATEWAY_SITE,
  checkGatewayBalance,
  connectGateway,
  ensureGatewayProvider,
  requestDeviceCode,
  resolveDeviceCode,
  resolveTokenOutcome,
  waitForApproval,
  writeGatewayCredential,
} from "./gateway-connect"
import { addRootObjectMember, hasRootObjectMember, parseJsonc } from "./jsonc-edit"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hypercode-gateway-"))
  roots.push(root)
  return root
}

function collectLog() {
  const warnings: string[] = []
  const messages: string[] = []
  return {
    warnings,
    messages,
    log: (message: string) => messages.push(message),
    warn: (message: string) => warnings.push(message),
  }
}

const envelope = (data: unknown) => ({ code: 0, message: "success", data })

/** A fetch stub driven by a queue of responses; extra calls repeat the last one. */
function scriptedFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: unknown }[] = []
  let index = 0
  const fetchImpl = async (url: string, init?: { body?: string }) => {
    const response = responses[Math.min(index, responses.length - 1)]
    index++
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined })
    return { status: response.status, json: async () => response.body }
  }
  return { fetchImpl, calls, callsMade: () => index }
}

describe("resolveDeviceCode", () => {
  test("reads the pairing payload out of the API envelope", () => {
    const code = resolveDeviceCode(
      envelope({
        device_code: "dev-1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://www.trust3.pro/device?code=ABCD-EFGH",
        expires_in: 600,
        interval: 5,
      }),
    )
    expect(code).toEqual({
      deviceCode: "dev-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://www.trust3.pro/device?code=ABCD-EFGH",
      expiresIn: 600,
      interval: 5,
    })
  })

  test("rejects a payload the site reported as an error", () => {
    expect(resolveDeviceCode({ code: 500, message: "boom" })).toBeUndefined()
    expect(resolveDeviceCode(undefined)).toBeUndefined()
  })

  test("rejects a payload missing either code", () => {
    expect(resolveDeviceCode(envelope({ user_code: "ABCD-EFGH" }))).toBeUndefined()
    expect(resolveDeviceCode(envelope({ device_code: "dev-1" }))).toBeUndefined()
  })

  test("falls back to conservative polling values when the site omits them", () => {
    const code = resolveDeviceCode(envelope({ device_code: "dev-1", user_code: "ABCD-EFGH" }))
    expect(code?.expiresIn).toBe(600)
    expect(code?.interval).toBe(5)
  })
})

describe("resolveTokenOutcome", () => {
  test("approved carries the key", () => {
    expect(resolveTokenOutcome(envelope({ status: "approved", api_key: "sk-abc" }))).toEqual({
      status: "approved",
      apiKey: "sk-abc",
    })
  })

  test("approved without a key is a failure, not a connection", () => {
    const outcome = resolveTokenOutcome(envelope({ status: "approved" }))
    expect(outcome.status).toBe("failed")
  })

  test("expired is terminal", () => {
    expect(resolveTokenOutcome(envelope({ status: "expired" }))).toEqual({ status: "expired" })
  })

  test("pending is distinguished so the polling loop can keep waiting", () => {
    const outcome = resolveTokenOutcome(envelope({ status: "pending" }))
    expect(outcome.status).toBe("failed")
    if (outcome.status === "failed") expect(outcome.reason.startsWith("pending:")).toBe(true)
  })
})

describe("requestDeviceCode", () => {
  test("defaults to the API origin, not the site origin", async () => {
    // Production splits them: the site is a static frontend that answers 405 to POST /api/v1/*, while the
    // Go backend lives on the API host (the deployed bundle points at https://api.trust3.pro/api/v1).
    // Pairing sent to the site would fail on deploy while every other test stayed green.
    const { fetchImpl, calls } = scriptedFetch([
      { status: 200, body: envelope({ device_code: "dev-1", user_code: "ABCD-EFGH" }) },
    ])
    await requestDeviceCode({ fetchImpl })

    expect(calls[0].url).toBe(`${GATEWAY_API_BASE}/api/v1/hypercode/device/code`)
    expect(GATEWAY_API_BASE).not.toBe(GATEWAY_SITE)
  })

  test("posts to the site's pairing endpoint and returns the code", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 200, body: envelope({ device_code: "dev-1", user_code: "ABCD-EFGH", interval: 1 }) },
    ])
    const code = await requestDeviceCode({ fetchImpl, baseUrl: "https://site.test" })
    expect(code.deviceCode).toBe("dev-1")
    expect(calls[0].url).toBe("https://site.test/api/v1/hypercode/device/code")
  })

  test("a non-200 answer is an error the caller can surface", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 429, body: { code: 429, message: "slow down" } }])
    await expect(requestDeviceCode({ fetchImpl })).rejects.toThrow("pairing is unavailable")
  })
})

describe("waitForApproval", () => {
  test("keeps polling while the site says pending, then returns the key", async () => {
    const { fetchImpl, callsMade } = scriptedFetch([
      { status: 200, body: envelope({ status: "pending" }) },
      { status: 200, body: envelope({ status: "pending" }) },
      { status: 200, body: envelope({ status: "approved", api_key: "sk-late" }) },
    ])
    const outcome = await waitForApproval({
      fetchImpl,
      deviceCode: "dev-1",
      intervalMs: 1000,
      timeoutMs: 60_000,
      sleep: async () => {},
    })
    expect(outcome).toEqual({ status: "approved", apiKey: "sk-late" })
    expect(callsMade()).toBe(3)
  })

  test("stops at its own deadline instead of trusting the server's expiry", async () => {
    const { fetchImpl, callsMade } = scriptedFetch([{ status: 200, body: envelope({ status: "pending" }) }])
    let clock = 0
    const outcome = await waitForApproval({
      fetchImpl,
      deviceCode: "dev-1",
      intervalMs: 1000,
      timeoutMs: 5_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(outcome).toEqual({ status: "expired" })
    // 5s deadline at 1s intervals: five polls, then stop.
    expect(callsMade()).toBe(5)
  })

  test("propagates an expired code immediately", async () => {
    const { fetchImpl, callsMade } = scriptedFetch([{ status: 200, body: envelope({ status: "expired" }) }])
    const outcome = await waitForApproval({
      fetchImpl,
      deviceCode: "dev-1",
      intervalMs: 1000,
      timeoutMs: 60_000,
      sleep: async () => {},
    })
    expect(outcome).toEqual({ status: "expired" })
    expect(callsMade()).toBe(1)
  })
})

describe("writeGatewayCredential", () => {
  test("stores the key as a 0600 api credential", async () => {
    const root = await tempRoot()
    const log = collectLog()
    expect(await writeGatewayCredential({ dataDir: root, apiKey: "sk-new", log })).toBe(true)

    const raw = await readFile(join(root, "auth.json"), "utf8")
    expect(JSON.parse(raw)).toEqual({ [GATEWAY_PROVIDER_ID]: { type: "api", key: "sk-new" } })
    // The secret file must not be world-readable — the engine itself writes it 0600.
    if (process.platform !== "win32") {
      const mode = (await stat(join(root, "auth.json"))).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })

  test("keeps the user's other provider credentials", async () => {
    const root = await tempRoot()
    await writeFile(
      join(root, "auth.json"),
      JSON.stringify({ anthropic: { type: "api", key: "sk-other" }, [GATEWAY_PROVIDER_ID]: { type: "api", key: "sk-old" } }),
      "utf8",
    )
    const log = collectLog()

    expect(await writeGatewayCredential({ dataDir: root, apiKey: "sk-new", log })).toBe(true)
    const after = JSON.parse(await readFile(join(root, "auth.json"), "utf8"))
    expect(after.anthropic).toEqual({ type: "api", key: "sk-other" })
    expect(after[GATEWAY_PROVIDER_ID]).toEqual({ type: "api", key: "sk-new" })
  })

  test("refuses to overwrite an auth store it cannot parse", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "auth.json"), "this is not json", "utf8")
    const log = collectLog()

    expect(await writeGatewayCredential({ dataDir: root, apiKey: "sk-new", log })).toBe(false)
    expect(await readFile(join(root, "auth.json"), "utf8")).toBe("this is not json")
    expect(log.warnings.length).toBe(1)
  })
})

describe("ensureGatewayProvider", () => {
  test("creates the config when the user has none", async () => {
    const root = await tempRoot()
    const log = collectLog()
    expect(await ensureGatewayProvider({ configDir: root, log })).toBe(true)

    const file = join(root, "hypercode.jsonc")
    expect(existsSync(file)).toBe(true)
    const parsed = parseJsonc(await readFile(file, "utf8")) as Record<string, Record<string, unknown>>
    expect(Object.keys(parsed.provider)).toEqual([GATEWAY_PROVIDER_ID])
    const options = (parsed.provider[GATEWAY_PROVIDER_ID] as Record<string, unknown>).options
    expect(options).toEqual({ baseURL: GATEWAY_BASE_URL })
  })

  test("never writes an apiKey field, which would shadow the stored credential", async () => {
    const root = await tempRoot()
    await ensureGatewayProvider({ configDir: root, log: collectLog() })
    const text = await readFile(join(root, "hypercode.jsonc"), "utf8")
    // The engine injects auth-store credentials only when `options.apiKey` is falsy — an empty string from
    // an older installer is exactly the bug that made the pasted key unreachable.
    expect(text.includes("apiKey")).toBe(false)
  })

  test("appends to an existing provider object without disturbing comments or other keys", async () => {
    const root = await tempRoot()
    const original = `{
  // HyperCode 引擎配置 —— 请勿手改
  "plugin": ["oh-my-openagent"],
  "provider": {
    "mine": { "npm": "x", "options": { "baseURL": "https://mine.test" } }
  },
  "model": "mine/foo"
}
`
    await writeFile(join(root, "hypercode.json"), original, "utf8")
    expect(await ensureGatewayProvider({ configDir: root, log: collectLog() })).toBe(true)

    const text = await readFile(join(root, "hypercode.json"), "utf8")
    expect(text.includes("// HyperCode 引擎配置 —— 请勿手改")).toBe(true)
    const parsed = parseJsonc(text) as Record<string, unknown>
    expect(Object.keys(parsed.provider as object).sort()).toEqual([GATEWAY_PROVIDER_ID, "mine"])
    expect(parsed.model).toBe("mine/foo")
  })

  test("leaves an existing gateway provider declaration alone", async () => {
    const root = await tempRoot()
    const original = `{ "provider": { "${GATEWAY_PROVIDER_ID}": { "options": { "baseURL": "https://custom.test" } } } }`
    await writeFile(join(root, "hypercode.json"), original, "utf8")

    expect(await ensureGatewayProvider({ configDir: root, log: collectLog() })).toBe(true)
    expect(await readFile(join(root, "hypercode.json"), "utf8")).toBe(original)
  })

  test("leaves an unparseable config alone instead of rewriting it", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "hypercode.json"), "not json at all", "utf8")
    const log = collectLog()

    expect(await ensureGatewayProvider({ configDir: root, log })).toBe(false)
    expect(await readFile(join(root, "hypercode.json"), "utf8")).toBe("not json at all")
    expect(log.warnings.length).toBe(1)
  })
})

describe("connectGateway", () => {
  test("runs the whole flow: code, browser, approval, both files written", async () => {
    const root = await tempRoot()
    const configDir = join(root, "config")
    const dataDir = join(root, "data")
    const { fetchImpl, calls } = scriptedFetch([
      {
        status: 200,
        body: envelope({
          device_code: "dev-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://www.trust3.pro/device?code=ABCD-EFGH",
          interval: 1,
          expires_in: 600,
        }),
      },
      { status: 200, body: envelope({ status: "pending" }) },
      { status: 200, body: envelope({ status: "approved", api_key: "sk-connected" }) },
    ])
    const opened: string[] = []
    const codes: string[] = []

    const result = await connectGateway({
      fetchImpl,
      configDir,
      dataDir,
      openExternal: async (url) => opened.push(url),
      onCode: (code) => codes.push(code.userCode),
      baseUrl: "https://site.test",
      log: collectLog(),
      sleep: async () => {},
    })

    expect(result).toEqual({ status: "connected" })
    // The user has to see the same code in both places, or they cannot consent to the right device.
    expect(codes).toEqual(["ABCD-EFGH"])
    expect(opened).toEqual(["https://www.trust3.pro/device?code=ABCD-EFGH"])
    expect(JSON.parse(await readFile(join(dataDir, "auth.json"), "utf8"))[GATEWAY_PROVIDER_ID]).toEqual({
      type: "api",
      key: "sk-connected",
    })
    const parsed = parseJsonc(await readFile(join(configDir, "hypercode.jsonc"), "utf8")) as Record<string, unknown>
    expect(parsed.provider).toEqual({
      [GATEWAY_PROVIDER_ID]: {
        npm: "@ai-sdk/openai-compatible",
        name: "HyperCode",
        options: { baseURL: GATEWAY_BASE_URL },
        models: { "deepseek-v4-pro": { name: "DeepSeek V4 Pro" }, "deepseek-flash": { name: "DeepSeek V4.1 Flash" } },
      },
    })
    expect(calls.length).toBe(3)
  })

  test("an expired code writes nothing at all", async () => {
    const root = await tempRoot()
    const configDir = join(root, "config")
    const dataDir = join(root, "data")
    const { fetchImpl } = scriptedFetch([
      { status: 200, body: envelope({ device_code: "dev-1", user_code: "ABCD-EFGH", interval: 1, expires_in: 600 }) },
      { status: 200, body: envelope({ status: "expired" }) },
    ])

    const result = await connectGateway({
      fetchImpl,
      configDir,
      dataDir,
      openExternal: async () => {},
      log: collectLog(),
      sleep: async () => {},
    })

    expect(result).toEqual({ status: "expired" })
    expect(existsSync(join(dataDir, "auth.json"))).toBe(false)
    expect(existsSync(join(configDir, "hypercode.jsonc"))).toBe(false)
  })

  test("failing to open the browser does not abort the pairing the user may still complete", async () => {
    const root = await tempRoot()
    const { fetchImpl } = scriptedFetch([
      { status: 200, body: envelope({ device_code: "dev-1", user_code: "ABCD-EFGH", interval: 1, expires_in: 600 }) },
      { status: 200, body: envelope({ status: "approved", api_key: "sk-connected" }) },
    ])

    const result = await connectGateway({
      fetchImpl,
      configDir: join(root, "config"),
      dataDir: join(root, "data"),
      openExternal: async () => {
        throw new Error("no browser")
      },
      log: collectLog(),
      sleep: async () => {},
    })

    expect(result).toEqual({ status: "connected" })
  })
})

describe("jsonc additive member edits", () => {
  test("detects a nested member without mistaking a deeper key for it", () => {
    const text = `{ "provider": { "deepseek": { "options": { "apiKey": "x" } } } }`
    expect(hasRootObjectMember(text, "provider", "deepseek")).toBe(true)
    // `options` and `apiKey` are inside deepseek's value, not members of provider.
    expect(hasRootObjectMember(text, "provider", "options")).toBe(false)
    expect(hasRootObjectMember(text, "provider", "apiKey")).toBe(false)
  })

  test("inserts into a non-empty object with a comma the document may not have had", () => {
    const next = addRootObjectMember(`{ "provider": { "a": 1 } }`, "provider", "b", "{ }")
    expect(next).toBeDefined()
    expect(parseJsonc(next!)).toEqual({ provider: { a: 1, b: {} } })
  })

  test("reports failure rather than guessing when provider is not an object", () => {
    expect(addRootObjectMember(`{ "provider": [] }`, "provider", "b", "{}")).toBeUndefined()
  })
})


describe("checkGatewayBalance", () => {
  test("reports unconfigured when no gateway credential is stored", async () => {
    const root = await tempRoot()
    const result = await checkGatewayBalance({
      dataDir: root,
      fetchImpl: async () => ({ status: 200, json: async () => ({}) }),
    })
    expect(result).toEqual({ status: "unconfigured" })
  })

  test("reports funded when the gateway serves the stored key", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "auth.json"), JSON.stringify({ [GATEWAY_PROVIDER_ID]: { type: "api", key: "sk-test" } }))
    const fetch = scriptedFetch([{ status: 200, body: { data: [] } }])
    const result = await checkGatewayBalance({ dataDir: root, fetchImpl: fetch.fetchImpl })
    expect(result).toEqual({ status: "funded" })
    expect(fetch.calls[0]?.url).toBe(`${GATEWAY_BASE_URL}/models`)
  })

  test("reports unfunded when the gateway denies the key", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "auth.json"), JSON.stringify({ [GATEWAY_PROVIDER_ID]: { type: "api", key: "sk-test" } }))
    const result = await checkGatewayBalance({
      dataDir: root,
      fetchImpl: async () => ({ status: 403, json: async () => ({}) }),
    })
    expect(result).toEqual({ status: "unfunded" })
  })

  test("reports unreachable when the request fails", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "auth.json"), JSON.stringify({ [GATEWAY_PROVIDER_ID]: { type: "api", key: "sk-test" } }))
    const result = await checkGatewayBalance({
      dataDir: root,
      fetchImpl: async () => {
        throw new Error("offline")
      },
    })
    expect(result).toEqual({ status: "unreachable" })
  })
})