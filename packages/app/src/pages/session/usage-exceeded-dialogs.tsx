import { useSDK } from "@/context/sdk"
import { Persist, persisted } from "@/utils/persist"
import { SessionStatus } from "@opencode-ai/sdk/v2"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSessionLayout } from "./session-layout"
import { useDialog } from "@opencode-ai/ui/context"
import { DialogUsageExceeded } from "@/components/dialog-usage-exceeded"
import { useI18n } from "@opencode-ai/ui/context"

// Triggers on quota exhaustion from ANY provider (DeepSeek, Anthropic, ...).
// The server already sends product-neutral copy + our site as the "learn more"
// link (packages/opencode/src/session/retry.ts), so the client only gates
// frequency and offers the BYOK escape hatch.
const EXCEEDED_FREE_TIER_LAST_SEEN_AT = "exceeded_free_tier_last_seen_at"
const EXCEEDED_FREE_TIER_DONT_SHOW = "exceeded_free_tier_dont_show"
const EXCEEDED_RATE_LIMIT_LAST_SEEN_AT = "exceeded_rate_limit_last_seen_at"
const EXCEEDED_RATE_LIMIT_DONT_SHOW = "exceeded_rate_limit_dont_show"
const EXCEEDED_WINDOW = 86_400_000 // 24 hrs

function exceededKeys(status: SessionStatus) {
  if (status.type !== "retry" || !status.action) return
  const { action } = status
  if (action.reason === "free_tier_limit") {
    return {
      lastSeenAt: EXCEEDED_FREE_TIER_LAST_SEEN_AT,
      dontShow: EXCEEDED_FREE_TIER_DONT_SHOW,
    } as const
  }
  if (action.reason === "account_rate_limit") {
    return {
      lastSeenAt: EXCEEDED_RATE_LIMIT_LAST_SEEN_AT,
      dontShow: EXCEEDED_RATE_LIMIT_DONT_SHOW,
    } as const
  }
}

export function useUsageExceededDialogs() {
  const sdk = useSDK()
  const dialog = useDialog()
  const { params } = useSessionLayout()
  const { t, locale } = useI18n()
  const isEnglish = () => locale() === "en"

  const [exceededState, setExceededState] = persisted(
    Persist.global("usage-exceeded"),
    createStore({
      [EXCEEDED_FREE_TIER_LAST_SEEN_AT]: null as null | number,
      [EXCEEDED_FREE_TIER_DONT_SHOW]: null as null | number,
      [EXCEEDED_RATE_LIMIT_LAST_SEEN_AT]: null as null | number,
      [EXCEEDED_RATE_LIMIT_DONT_SHOW]: null as null | number,
    }),
  )

  const openByok = () => {
    void import("../../components/dialog-connect-provider").then((x) => {
      const controller = x.useProviderConnectController()
      controller.select("deepseek")
      void dialog.show(() => <x.DialogConnectProvider controller={controller} />)
    })
  }

  onCleanup(
    sdk().event.on("session.status", (evt) => {
      if (evt.properties.sessionID !== params.id) return
      if (evt.properties.status.type !== "retry") return
      const { action } = evt.properties.status
      if (!action) return
      if (dialog.active) return

      const keys = exceededKeys(evt.properties.status)
      if (!keys) return

      const seen = exceededState[keys.lastSeenAt]
      if (seen && Date.now() - seen < EXCEEDED_WINDOW) return
      if (exceededState[keys.dontShow]) return

      const isFreeTier = action.reason === "free_tier_limit"
      dialog.show(() => (
        <DialogUsageExceeded
          title={
            isEnglish()
              ? action.title
              : t(isFreeTier ? "dialog.usageExceeded.freeTier.title" : "dialog.usageExceeded.accountRateLimit.title")
          }
          description={
            isEnglish()
              ? action.message
              : t(
                  isFreeTier
                    ? "dialog.usageExceeded.freeTier.description"
                    : "dialog.usageExceeded.accountRateLimit.description",
                )
          }
          actionLabel={
            isEnglish()
              ? action.label
              : t(
                  isFreeTier
                    ? "dialog.usageExceeded.freeTier.actionLabel"
                    : "dialog.usageExceeded.accountRateLimit.actionLabel",
                )
          }
          configureKeyLabel={t("dialog.usageExceeded.configureKey")}
          link={action.link}
          onClose={(dontShowAgain) => {
            setExceededState(keys.lastSeenAt, Date.now())
            if (dontShowAgain) setExceededState(keys.dontShow, Date.now())
            else openByok()
          }}
        />
      ))
    }),
  )
}
