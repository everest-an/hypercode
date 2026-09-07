/**
 * license.ts — HyperCode 订阅许可证决策的纯逻辑核心(无 Electron 依赖, 可单测)。
 *
 * 决策模型(轻量校验 + 试用期, 先个人后企业):
 *   - 首次启动记录 trialStartedAt(7 天试用窗口)。
 *   - 用户输入 license key → 调 billing /verify → valid → licensed。
 *   - billing 未配置/不可达(configured=false / 网络失败)→ 不锁死: 维持当前决策,
 *     新用户按试用放行(grace)。这是"轻量校验防君子"的默认行为。
 *   - 试用到期且无有效 key → expired(渲染层引导购买)。
 *
 * 后端契约(billing_service.py):
 *   GET/POST {BASE_URL}/billing/verify  body {license_key, machine_id}
 *     200 {valid:true, plan, expires_at} | 401 invalid | 402 not active/expired | 503 not configured
 */

export const TRIAL_DAYS = 7

export type VerifyResult =
  | { kind: "valid"; plan: string; expiresAt: string | null }
  | { kind: "invalid" } // 401
  | { kind: "not-active" } // 402
  | { kind: "unconfigured" } // 503 / empty config
  | { kind: "unreachable" } // network / parse error
  | { kind: "not-tried" } // 尚未调用校验(离线启动)

export type LicenseDecision =
  | { mode: "licensed"; plan: string; expiresAt: string | null }
  | { mode: "trial"; daysLeft: number }
  | { mode: "expired" } // 试用过期且无有效 license

export type DecisionInput = {
  now: Date
  trialStartedAt: Date | null
  hasKey: boolean
  verify: VerifyResult
}

/** 试用剩余天数, 可为负数(已过期). */
export function trialDaysLeft(now: Date, trialStartedAt: Date | null): number {
  if (!trialStartedAt) return TRIAL_DAYS
  const ms = now.getTime() - trialStartedAt.getTime()
  return Math.ceil(ms / (24 * 60 * 60 * 1000) * -1 + TRIAL_DAYS)
}

/**
 * 核心决策。
 * - valid key → licensed(即使试用过期也放行)。
 * - 无 key / key 无效:
 *   - 试用窗口内 → trial;
 *   - 试用已过 → expired, 但 billing 未配置/不可达时仍给 expired 之外的一个兜底:
 *     离线环境(verify 未尝试/不可达/未配置)不锁死 —— 返回 trial(daysLeft 可负,
 *     渲染层显示"试用已结束, 连接后验证"由上层处理)。
 */
export function decideLicense(input: DecisionInput): LicenseDecision {
  const { now, trialStartedAt, hasKey, verify } = input
  if (hasKey && verify.kind === "valid") {
    return { mode: "licensed", plan: verify.plan, expiresAt: verify.expiresAt }
  }
  const left = trialDaysLeft(now, trialStartedAt)
  // 有 key 但校验失败(无效/未激活)且试用已过 → 明确过期, 要求重新激活。
  if (hasKey && (verify.kind === "invalid" || verify.kind === "not-active")) {
    return left > 0 ? { mode: "trial", daysLeft: left } : { mode: "expired" }
  }
  // 无 key 或后端不可用: 试用窗口内正常放行。
  if (left > 0) return { mode: "trial", daysLeft: left }
  // 试用到期:
  //   后端未配置/不可达 → 不锁死(离线可用性优先), 返回 trial 但 daysLeft<=0 由 UI 提示。
  if (verify.kind === "unconfigured" || verify.kind === "unreachable" || verify.kind === "not-tried") {
    return { mode: "trial", daysLeft: left }
  }
  return { mode: "expired" }
}

/** 生成 machine_id(首次启动持久化用). 调用方负责存 store. */
export function generateMachineId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * 校验响应归一化: 把 fetch 结果变成 VerifyResult。
 * httpStatus:
 *   200  → 解析 body {valid:true, plan, expires_at}
 *   401  → invalid
 *   402  → not-active
 *   503  → unconfigured
 *   其它 / 网络错误 / JSON 解析失败 → unreachable
 */
export async function parseVerifyResponse(response: Response): Promise<VerifyResult> {
  if (response.status === 200) {
    try {
      const body = (await response.json()) as { valid?: boolean; plan?: string; expires_at?: string | null }
      if (body && body.valid) {
        return { kind: "valid", plan: body.plan || "pro_monthly", expiresAt: body.expires_at ?? null }
      }
      return { kind: "invalid" }
    } catch {
      return { kind: "unreachable" }
    }
  }
  if (response.status === 401) return { kind: "invalid" }
  if (response.status === 402) return { kind: "not-active" }
  if (response.status === 503) return { kind: "unconfigured" }
  return { kind: "unreachable" }
}
