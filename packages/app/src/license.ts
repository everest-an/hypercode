/**
 * license.ts — Renderer-facing license status types.
 *
 * These mirror the shape returned over IPC by the desktop main-process license
 * module (license-state.ts). The app layer must not import desktop-only types,
 * so this file is the single declaration the settings UI reads from. The shape
 * is a plain serializable value, so it must stay in sync with:
 *   - packages/desktop/src/main/license.ts        (decision logic)
 *   - packages/desktop/src/main/license-state.ts  (IPC payload)
 *   - packages/desktop/src/preload/types.ts       (preload bridge typing)
 */

export type LicenseDecision =
  | { mode: "licensed"; plan: string; expiresAt: string | null }
  | { mode: "trial"; daysLeft: number }
  | { mode: "expired" }

export type LicenseVerifyKind =
  | "valid"
  | "invalid"
  | "not-active"
  | "unconfigured"
  | "unreachable"
  | "not-tried"

export type LicenseStatus = {
  decision: LicenseDecision
  hasKey: boolean
  machineId: string
  keySuffix: string | null
  verifyKind: LicenseVerifyKind
  verifyError: string | null
  /** True when the UI should surface a subscribe/activate prompt. */
  needsAttention: boolean
}

export type LicensePlatform = {
  getStatus(): Promise<LicenseStatus>
  activate(key: string): Promise<LicenseStatus>
  clear(): Promise<LicenseStatus>
}

/**
 * What the subscribe prompt should show, derived from a raw LicenseStatus.
 *
 * The desktop main process already computes `needsAttention` (trial ending soon
 * or expired). This maps it to the two renderer surfaces:
 *   - "expiring": slim banner while the trial still has days left (<= 2)
 *   - "expired":  banner + a launch dialog (no valid license / trial over)
 */
export type LicenseNotice = { kind: "none" } | { kind: "expiring"; daysLeft: number } | { kind: "expired" }

export function resolveLicenseNotice(status: LicenseStatus | undefined): LicenseNotice {
  if (!status || !status.needsAttention) return { kind: "none" }
  if (status.decision.mode === "expired") return { kind: "expired" }
  if (status.decision.mode === "trial") {
    return status.decision.daysLeft > 0 ? { kind: "expiring", daysLeft: status.decision.daysLeft } : { kind: "expired" }
  }
  return { kind: "none" }
}

/**
 * 桌面端订阅购买/管理落地页。
 * 指向 trust3 微信支付页:新用户微信扫码注册即领 30 天试用,付费走微信。
 */
export const LICENSE_PURCHASE_URL = "https://www.trust3.pro/purchase"
