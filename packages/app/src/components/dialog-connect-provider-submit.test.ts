import { describe, expect, test } from "bun:test"
import { submitApiKey } from "./dialog-connect-provider-submit"

const t = (key: string, vars?: Record<string, string | number>) =>
  vars && "error" in vars ? `${key}:${vars.error}` : key

function harness(overrides: Partial<Parameters<typeof submitApiKey>[0]> = {}) {
  const errors: (string | undefined)[] = []
  let completed = 0
  const sent: string[] = []
  return {
    errors,
    sent,
    completed: () => completed,
    run: (apiKey: string) =>
      submitApiKey({
        apiKey,
        connect: async (key) => {
          sent.push(key)
        },
        complete: async () => {
          completed++
        },
        t,
        setError: (message) => errors.push(message),
        ...overrides,
      }),
  }
}

describe("submitApiKey", () => {
  test("sends the key and completes when the server accepts it", async () => {
    const h = harness()

    expect(await h.run("sk-live-1234")).toBe(true)
    expect(h.sent).toEqual(["sk-live-1234"])
    expect(h.completed()).toBe(1)
    // Cleared once, never set to a message.
    expect(h.errors).toEqual([undefined])
  })

  // The bug this file exists for: the rejection escaped as an unhandled promise and the dialog sat
  // unchanged, which is indistinguishable from a button that does nothing.
  test("shows the server's reason when the key is rejected", async () => {
    const h = harness({
      connect: async () => {
        throw new Error("Incorrect API key provided")
      },
    })

    expect(await h.run("sk-typo")).toBe(false)
    expect(h.errors.at(-1)).toBe("provider.connect.status.failed:Incorrect API key provided")
    // Nothing is closed or refreshed on a refusal — the user has to be able to fix the key in place.
    expect(h.completed()).toBe(0)
  })

  test("still reports something when the failure carries no message", async () => {
    const h = harness({
      connect: async () => {
        throw new Error("")
      },
    })

    await h.run("sk-live-1234")
    // formatServerError's own fallback text, not a raw key: its `tr` helper treats "translator returned the
    // key unchanged" as untranslated and uses the literal instead.
    expect(h.errors.at(-1)).toBe("provider.connect.status.failed:Unknown error")
    expect(h.completed()).toBe(0)
  })

  // Documents a real limitation rather than asserting a wish. formatServerError only reaches into
  // `cause.body` for two typed shapes (ConfigInvalidError, ProviderModelNotFoundError); for anything else it
  // returns the outer Error's message. So when the SDK wraps a server refusal in a generic transport error,
  // the user sees "Request failed" and not the reason. Fixing that means changing a helper shared by every
  // error surface in the app, which is a wider decision than this form.
  test("shows the outer error when a server reason is wrapped in a transport error", async () => {
    const h = harness({
      connect: async () => {
        throw new Error("Request failed", { cause: { body: new Error("Key has expired") } })
      },
    })

    await h.run("sk-expired")
    expect(h.errors.at(-1)).toBe("provider.connect.status.failed:Request failed")
  })

  test("rejects an empty key without calling the server", async () => {
    const h = harness()

    expect(await h.run("   ")).toBe(false)
    expect(h.sent).toEqual([])
    expect(h.errors).toEqual(["provider.connect.apiKey.required"])
    expect(h.completed()).toBe(0)
  })

  // A failure to close is not a bad key. Reporting it beside the key field would send the user to fix
  // something that is not wrong, so it propagates instead.
  test("does not blame the key when closing the dialog fails", async () => {
    const h = harness({
      complete: async () => {
        throw new Error("refresh failed")
      },
    })

    await expect(h.run("sk-live-1234")).rejects.toThrow("refresh failed")
    expect(h.errors).toEqual([undefined])
  })
})
