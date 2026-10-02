import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Component, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { LICENSE_PURCHASE_URL, resolveLicenseNotice, type LicenseStatus } from "@/license"

/**
 * Proactive HyperCode Pro subscribe prompt (desktop only).
 *
 * The main process already computes `needsAttention` (trial ending soon or
 * expired) and ships it over IPC, but nothing in the renderer surfaced it, so
 * trial users were never prompted to subscribe. This component renders:
 *   - a slim floating banner while the trial is ending (<= 2 days) or expired
 *   - one launch dialog once the trial has ended
 *
 * Prompts only — app usage is never blocked. Renders nothing on web.
 */
export const LicenseNotice: Component = () => {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()

  const enabled = () => platform.platform === "desktop" && Boolean(platform.license)
  const [status, setStatus] = createSignal<LicenseStatus | undefined>()
  const [dismissed, setDismissed] = createSignal(false)
  const notice = createMemo(() => resolveLicenseNotice(status()))

  const refresh = () => {
    void platform.license
      ?.getStatus()
      .then(setStatus)
      .catch(() => undefined)
  }

  onMount(() => {
    if (!enabled()) return
    refresh()
    let shown = false
    const timer = setTimeout(() => {
      if (shown || notice().kind !== "expired") return
      shown = true
      dialog.show(() => <DialogLicenseNotice onLicensed={refresh} />)
    }, 600)
    onCleanup(() => clearTimeout(timer))
  })

  const bannerText = createMemo(() => {
    const current = notice()
    if (current.kind === "expiring") return language.t("license.notice.banner.expiring", { days: current.daysLeft })
    if (current.kind === "expired") return language.t("license.notice.banner.expired")
    return ""
  })

  return (
    <Show when={enabled() && notice().kind !== "none" && !dismissed()}>
      <div
        role="status"
        class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border-weak-base bg-surface-raised-base px-4 py-2.5 shadow-lg"
      >
        <span class="text-12-regular whitespace-nowrap text-text-strong">{bannerText()}</span>
        <ButtonV2 size="small" variant="contrast" onClick={() => platform.openExternal(LICENSE_PURCHASE_URL)}>
          {language.t("license.notice.subscribe")}
        </ButtonV2>
        <button
          type="button"
          aria-label={language.t("license.notice.dismiss")}
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-weak hover:bg-surface-raised-base-hover"
          onClick={() => setDismissed(true)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M12.4446 3.55469L3.55566 12.4436M3.55566 3.55469L12.4446 12.4436"
              stroke="currentColor"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </Show>
  )
}

/**
 * Launch dialog shown once per app start when the trial has ended. Mirrors the
 * activation flow from the settings license panel so a user with a key never
 * has to leave the prompt.
 */
const DialogLicenseNotice: Component<{ onLicensed?: () => void }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const [view, setView] = createSignal<"main" | "activate">("main")
  const [key, setKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const subscribe = () => {
    platform.openExternal(LICENSE_PURCHASE_URL)
    dialog.close()
  }

  const activate = async () => {
    const api = platform.license
    const value = key().trim()
    if (!api || !value || busy()) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.activate(value)
      if (next.decision.mode === "licensed") {
        props.onLicensed?.()
        dialog.close()
      } else {
        setError(language.t("settings.license.activate.error"))
      }
    } catch {
      setError(language.t("settings.license.activate.error"))
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    void activate()
  }

  return (
    <Dialog fit class="w-[min(calc(100vw-40px),480px)]">
      <DialogHeader>
        <DialogTitle>{language.t("license.notice.dialog.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex w-full min-w-0 flex-col gap-4 px-4 pb-2">
        <Show
          when={view() === "main"}
          fallback={
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="text-12-regular text-text-base">{language.t("settings.license.activate.label")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={key()}
                placeholder={language.t("settings.license.activate.placeholder")}
                invalid={Boolean(error())}
                disabled={busy()}
                autofocus
                onInput={(event) => setKey(event.currentTarget.value)}
                onKeyDown={onKeyDown}
              />
              <Show when={error()}>
                <span class="text-12-regular text-text-danger-base">{error()}</span>
              </Show>
            </div>
          }
        >
          <span class="text-14-regular text-text-base">{language.t("license.notice.dialog.body")}</span>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Show when={view() === "main"}>
          <>
            <ButtonV2 variant="ghost-muted" onClick={() => dialog.close()}>
              {language.t("license.notice.dialog.later")}
            </ButtonV2>
            <ButtonV2 variant="neutral" onClick={() => setView("activate")}>
              {language.t("license.notice.dialog.activate")}
            </ButtonV2>
            <ButtonV2 variant="contrast" onClick={subscribe}>
              {language.t("license.notice.dialog.subscribe")}
            </ButtonV2>
          </>
        </Show>
        <Show when={view() === "activate"}>
          <>
            <ButtonV2 variant="ghost-muted" onClick={() => dialog.close()}>
              {language.t("license.notice.dialog.later")}
            </ButtonV2>
            <ButtonV2 variant="contrast" disabled={!key().trim() || busy()} onClick={() => void activate()}>
              {language.t("settings.license.activate.button")}
            </ButtonV2>
          </>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
