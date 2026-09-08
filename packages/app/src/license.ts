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

/** 桌面端订阅购买/管理落地页(官网定价区). */
export const LICENSE_PURCHASE_URL = "https://awareliquid.ai/en/hypercode#pricing"
