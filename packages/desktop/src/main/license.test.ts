import { describe, expect, test } from "bun:test"

import {
  decideLicense,
  generateMachineId,
  parseVerifyResponse,
  trialDaysLeft,
  TRIAL_DAYS,
  type DecisionInput,
  type VerifyResult,
} from "./license"

function makeInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    now: new Date("2026-09-07T00:00:00Z"),
    trialStartedAt: null,
    hasKey: false,
    verify: { kind: "not-tried" },
    ...overrides,
  }
}

describe("trialDaysLeft", () => {
  test("returns full trial when never started", () => {
    expect(trialDaysLeft(new Date("2026-09-07T00:00:00Z"), null)).toBe(TRIAL_DAYS)
  })
  test("counts down from start", () => {
    const start = new Date("2026-09-01T00:00:00Z")
    expect(trialDaysLeft(new Date("2026-09-07T00:00:00Z"), start)).toBe(1) // day 7 -> 1 left
  })
  test("negative when expired", () => {
    const start = new Date("2026-08-25T00:00:00Z") // 13 days ago
    expect(trialDaysLeft(new Date("2026-09-07T00:00:00Z"), start)).toBe(-6)
  })
})

describe("decideLicense", () => {
  test("licensed when valid key present", () => {
    const d = decideLicense(
      makeInput({
        hasKey: true,
        verify: { kind: "valid", plan: "pro_monthly", expiresAt: "2026-10-07T00:00:00Z" },
      }),
    )
    expect(d).toEqual({ mode: "licensed", plan: "pro_monthly", expiresAt: "2026-10-07T00:00:00Z" })
  })

  test("licensed even when trial expired, as long as key valid", () => {
    const start = new Date("2026-08-01T00:00:00Z")
    const d = decideLicense(
      makeInput({
        trialStartedAt: start,
        hasKey: true,
        verify: { kind: "valid", plan: "pro_monthly", expiresAt: null },
      }),
    )
    expect(d.mode).toBe("licensed")
  })

  test("trial within window when no key", () => {
    const d = decideLicense(makeInput({ verify: { kind: "not-tried" } }))
    expect(d).toEqual({ mode: "trial", daysLeft: 7 })
  })

  test("trial when key invalid but trial still active", () => {
    const start = new Date("2026-09-05T00:00:00Z")
    const d = decideLicense(
      makeInput({
        trialStartedAt: start,
        hasKey: true,
        verify: { kind: "invalid" },
      }),
    )
    expect(d.mode).toBe("trial")
    expect((d as { daysLeft: number }).daysLeft).toBeGreaterThan(0)
  })

  test("expired when trial over and key invalid", () => {
    const start = new Date("2026-08-20T00:00:00Z") // 18 days ago
    const d = decideLicense(
      makeInput({
        trialStartedAt: start,
        hasKey: true,
        verify: { kind: "invalid" },
      }),
    )
    expect(d).toEqual({ mode: "expired" })
  })

  test("not locked when trial over but billing unreachable (grace)", () => {
    const start = new Date("2026-08-20T00:00:00Z") // expired
    for (const verify of [
      { kind: "unconfigured" },
      { kind: "unreachable" },
      { kind: "not-tried" },
    ] as VerifyResult[]) {
      const d = decideLicense(
        makeInput({
          trialStartedAt: start,
          hasKey: false,
          verify,
        }),
      )
      // 不锁死: 即使 daysLeft<=0, 后端不可达时仍返回 trial 由 UI 提示, 而不是 expired 硬拦截
      expect(d.mode).toBe("trial")
    }
  })

  test("hard expired only when backend confirmed and no valid key", () => {
    const start = new Date("2026-08-20T00:00:00Z") // expired
    const d = decideLicense(
      makeInput({
        trialStartedAt: start,
        hasKey: false,
        verify: { kind: "not-active" },
      }),
    )
    expect(d).toEqual({ mode: "expired" })
  })
})

describe("generateMachineId", () => {
  test("generates UUID v4 shape", () => {
    const id = generateMachineId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  test("generates distinct ids", () => {
    expect(generateMachineId()).not.toBe(generateMachineId())
  })
})

describe("parseVerifyResponse", () => {
  function fakeResponse(status: number, body: unknown): Response {
    return new Response(status === 200 ? JSON.stringify(body) : "", { status })
  }

  test("200 valid", async () => {
    const r = await parseVerifyResponse(fakeResponse(200, { valid: true, plan: "pro_monthly", expires_at: "x" }))
    expect(r).toEqual({ kind: "valid", plan: "pro_monthly", expiresAt: "x" })
  })
  test("200 valid without expiry", async () => {
    const r = await parseVerifyResponse(fakeResponse(200, { valid: true }))
    expect(r).toEqual({ kind: "valid", plan: "pro_monthly", expiresAt: null })
  })
  test("200 invalid body", async () => {
    const r = await parseVerifyResponse(fakeResponse(200, { valid: false }))
    expect(r).toEqual({ kind: "invalid" })
  })
  test("401 invalid", async () => {
    expect(await parseVerifyResponse(fakeResponse(401, null))).toEqual({ kind: "invalid" })
  })
  test("402 not-active", async () => {
    expect(await parseVerifyResponse(fakeResponse(402, null))).toEqual({ kind: "not-active" })
  })
  test("503 unconfigured", async () => {
    expect(await parseVerifyResponse(fakeResponse(503, null))).toEqual({ kind: "unconfigured" })
  })
  test("500 unreachable", async () => {
    expect(await parseVerifyResponse(fakeResponse(500, null))).toEqual({ kind: "unreachable" })
  })
})
