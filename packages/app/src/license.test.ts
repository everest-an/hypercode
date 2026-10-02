import { describe, expect, test } from "bun:test"
import { resolveLicenseNotice, type LicenseStatus } from "./license"

const base: LicenseStatus = {
  decision: { mode: "trial", daysLeft: 5 },
  hasKey: false,
  machineId: "machine-0001",
  keySuffix: null,
  verifyKind: "not-tried",
  verifyError: null,
  needsAttention: false,
}

describe("resolveLicenseNotice", () => {
  test("no status → none", () => {
    expect(resolveLicenseNotice(undefined)).toEqual({ kind: "none" })
  })

  test("licensed → none", () => {
    expect(
      resolveLicenseNotice({
        ...base,
        decision: { mode: "licensed", plan: "pro_monthly", expiresAt: null },
      }),
    ).toEqual({ kind: "none" })
  })

  test("trial well within window → none", () => {
    expect(resolveLicenseNotice({ ...base, decision: { mode: "trial", daysLeft: 2 } })).toEqual({ kind: "none" })
  })

  test("trial 2 days left → expiring", () => {
    expect(
      resolveLicenseNotice({ ...base, decision: { mode: "trial", daysLeft: 2 }, needsAttention: true }),
    ).toEqual({ kind: "expiring", daysLeft: 2 })
  })

  test("trial 1 day left → expiring", () => {
    expect(
      resolveLicenseNotice({ ...base, decision: { mode: "trial", daysLeft: 1 }, needsAttention: true }),
    ).toEqual({ kind: "expiring", daysLeft: 1 })
  })

  test("trial 0 days left (grace mode) → expired", () => {
    expect(
      resolveLicenseNotice({ ...base, decision: { mode: "trial", daysLeft: 0 }, needsAttention: true }),
    ).toEqual({ kind: "expired" })
  })

  test("trial past expiry (grace mode) → expired", () => {
    expect(
      resolveLicenseNotice({ ...base, decision: { mode: "trial", daysLeft: -3 }, needsAttention: true }),
    ).toEqual({ kind: "expired" })
  })

  test("explicit expired decision → expired", () => {
    expect(
      resolveLicenseNotice({
        ...base,
        decision: { mode: "expired" },
        hasKey: true,
        keySuffix: "ABCD",
        verifyKind: "invalid",
        needsAttention: true,
      }),
    ).toEqual({ kind: "expired" })
  })

  test("stored key but billing unreachable → none (no nagging while offline)", () => {
    expect(
      resolveLicenseNotice({
        ...base,
        decision: { mode: "trial", daysLeft: -1 },
        hasKey: true,
        keySuffix: "ABCD",
        verifyKind: "unreachable",
        needsAttention: false,
      }),
    ).toEqual({ kind: "none" })
  })
})
