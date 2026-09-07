/**
 * license-state.ts — HyperCode 桌面端许可证状态(主进程, 接 store + billing 后端)。
 *
 * 职责:
 *   - 首次启动生成并持久化 machine_id
 *   - 记录试用开始时间(首次)
 *   - 读取/写入用户粘贴的 license key
 *   - 有 key 时调 billing /verify; 无 key 或后端不可达时按试用/grace 决策
 *   - 导出 LicenseStatus 供 IPC / renderer 显示
 *
 * 默认行为是"轻量 + 不锁死": billing 未配置/网络失败/离线启动 都不会把用户挡在门外,
 * 只有后端明确返回 not-active/invalid 且试用过期才报 expired(见 license.ts 决策)。
 */

import { getLogger } from "./logging"
import { getStore } from "./store"
import {
  LICENSE_KEY_KEY,
  LICENSE_MACHINE_ID_KEY,
  LICENSE_TRIAL_START_KEY,
  LICENSE_VERIFY_BASE_URL,
} from "./store-keys"
import {
  decideLicense,
  generateMachineId,
  parseVerifyResponse,
  trialDaysLeft,
  type LicenseDecision,
  type VerifyResult,
} from "./license"

export type LicenseStatus = {
  decision: LicenseDecision
  hasKey: boolean
  machineId: string
  keySuffix: string | null
  verifyKind: VerifyResult["kind"]
  verifyError: string | null
  /** 渲染层是否该显示"订阅引导"横幅(试用剩余 <= 2 天或已过期但后端不可达)。 */
  needsAttention: boolean
}

const VERIFY_TIMEOUT_MS = 8000

function store() {
  return getStore()
}

function getOrCreateMachineId(): string {
  const existing = store().get(LICENSE_MACHINE_ID_KEY)
  if (typeof existing === "string" && existing.length > 0) return existing
  const id = generateMachineId()
  store().set(LICENSE_MACHINE_ID_KEY, id)
  return id
}

function getOrCreateTrialStart(): Date {
  const raw = store().get(LICENSE_TRIAL_START_KEY)
  if (typeof raw === "string" && raw) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  const start = new Date()
  store().set(LICENSE_TRIAL_START_KEY, start.toISOString())
  return start
}

function getKey(): string | null {
  const raw = store().get(LICENSE_KEY_KEY)
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null
}

function persistKey(key: string | null) {
  if (key) store().set(LICENSE_KEY_KEY, key.trim())
  else store().delete(LICENSE_KEY_KEY)
}

async function verifyOnServer(key: string, machineId: string): Promise<VerifyResult> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
    try {
      const res = await fetch(`${LICENSE_VERIFY_BASE_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key, machine_id: machineId }),
        signal: controller.signal,
      })
      return await parseVerifyResponse(res)
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    getLogger().warn("license verify network error", error)
    return { kind: "unreachable" }
  }
}

/** 计算当前 license 状态(不发起网络请求; 适合启动时快速判断本地 key/试用). */
export function getLocalLicenseStatus(
  now: Date = new Date(),
): Omit<LicenseStatus, "verifyKind" | "verifyError" | "needsAttention"> {
  const machineId = getOrCreateMachineId()
  const trialStart = getOrCreateTrialStart()
  const key = getKey()
  const hasKey = key !== null
  const decision = decideLicense({
    now,
    trialStartedAt: trialStart,
    hasKey,
    verify: { kind: "not-tried" },
  })
  return {
    decision,
    hasKey,
    machineId,
    keySuffix: key ? key.slice(-4) : null,
  }
}

/** 完整状态: 本地 + (若有 key) 联网校验. */
export async function getLicenseStatus(now: Date = new Date()): Promise<LicenseStatus> {
  const machineId = getOrCreateMachineId()
  const trialStart = getOrCreateTrialStart()
  const key = getKey()
  const hasKey = key !== null
  const keySuffix = key ? key.slice(-4) : null

  let verify: VerifyResult = { kind: "not-tried" }
  let verifyError: string | null = null
  if (hasKey && key) {
    verify = await verifyOnServer(key, machineId)
    if (verify.kind === "unreachable") verifyError = "network"
    if (verify.kind === "unconfigured") verifyError = "not-configured"
  }

  const decision = decideLicense({ now, trialStartedAt: trialStart, hasKey, verify })
  const left = trialDaysLeft(now, trialStart)
  const needsAttention =
    decision.mode === "expired" ||
    (decision.mode === "trial" && left <= 2 && verify.kind === "not-tried")

  return {
    decision,
    hasKey,
    machineId,
    keySuffix,
    verifyKind: verify.kind,
    verifyError,
    needsAttention,
  }
}

/** 用户从官网成功页复制 key 后调用. */
export async function activateLicenseKey(key: string, now: Date = new Date()): Promise<LicenseStatus> {
  persistKey(key)
  // 激活成功 → 重置试用起点? 不需要: 有效 key 在 decideLicense 中优先于试用。
  return getLicenseStatus(now)
}

/** 清除 key(用户主动移除 / 订阅到期后). */
export async function clearLicenseKey(now: Date = new Date()): Promise<LicenseStatus> {
  persistKey(null)
  return getLicenseStatus(now)
}
