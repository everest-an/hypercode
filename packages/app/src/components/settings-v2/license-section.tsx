import { type Component, Show, createMemo, createResource, createSignal } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { LICENSE_PURCHASE_URL, type LicenseStatus } from "@/license"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

/**
 * HyperCode Pro subscription license panel.
 *
 * Self-contained: depends only on the platform license capability and the
 * language context, so it renders in the desktop app and in Storybook. Hidden
 * entirely on web, where `platform.license` is absent.
 */
export const SettingsLicenseV2: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  const licenseAvailable = createMemo(() => platform.platform === "desktop" && Boolean(platform.license))

  const [licenseStatus, { refetch: refetchLicense }] = createResource(
    () => platform.platform === "desktop" && Boolean(platform.license),
    () => Promise.resolve(platform.license?.getStatus() ?? undefined).catch(() => undefined),
    { initialValue: undefined as LicenseStatus | undefined },
  )

  const [licenseKeyInput, setLicenseKeyInput] = createSignal("")
  const [licenseBusy, setLicenseBusy] = createSignal(false)
  const [licenseError, setLicenseError] = createSignal<string | null>(null)

  const activateLicense = async () => {
    const api = platform.license
    const key = licenseKeyInput().trim()
    if (!api || !key || licenseBusy()) return
    setLicenseBusy(true)
    setLicenseError(null)
    try {
      const next = await api.activate(key)
      if (next.decision.mode === "licensed") {
        setLicenseKeyInput("")
      } else {
        setLicenseError(language.t("settings.license.activate.error"))
      }
      await refetchLicense()
    } catch {
      setLicenseError(language.t("settings.license.activate.error"))
    } finally {
      setLicenseBusy(false)
    }
  }

  const clearLicense = async () => {
    const api = platform.license
    if (!api) return
    setLicenseError(null)
    await api.clear()
    await refetchLicense()
  }

  const licenseTitle = createMemo(() => {
    const status = licenseStatus()
    if (!status) return language.t("settings.license.status.unlicensed")
    if (status.decision.mode === "licensed") return language.t("settings.license.status.active")
    if (status.decision.mode === "trial") {
      return status.decision.daysLeft > 0
        ? language.t("settings.license.status.trial", { days: status.decision.daysLeft })
        : language.t("settings.license.status.trial.zero")
    }
    return language.t("settings.license.status.expired")
  })

  const licenseDetail = createMemo(() => {
    const status = licenseStatus()
    const error = licenseError()
    if (error) return error
    if (!status) return ""
    if (status.decision.mode === "licensed") {
      return language.t("settings.license.status.active.detail", { plan: status.decision.plan })
    }
    if (status.hasKey && status.keySuffix) return `\u2022\u2022\u2022\u2022 ${status.keySuffix}`
    return ""
  })

  return (
    <Show when={licenseAvailable()}>
      <div class="settings-v2-section">
        <h3 class="settings-v2-section-title">{language.t("settings.general.section.license")}</h3>

        <SettingsListV2>
          <SettingsRowV2 title={licenseTitle()} description={licenseDetail()}>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <ButtonV2 size="small" variant="neutral" onClick={() => platform.openExternal(LICENSE_PURCHASE_URL)}>
                {language.t("settings.license.manage")}
              </ButtonV2>
              <Show when={licenseStatus()?.hasKey}>
                <ButtonV2 size="small" variant="ghost-muted" onClick={() => void clearLicense()}>
                  {language.t("settings.license.remove")}
                </ButtonV2>
              </Show>
            </div>
          </SettingsRowV2>

          <Show when={licenseStatus()?.decision.mode !== "licensed"}>
            <SettingsRowV2 title={language.t("settings.license.activate.label")} description="">
              <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
                <TextInputV2
                  class="w-full min-w-0 sm:w-64"
                  appearance="base"
                  data-action="settings-license-key-input"
                  value={licenseKeyInput()}
                  onInput={(event) => setLicenseKeyInput(event.currentTarget.value)}
                  placeholder={language.t("settings.license.activate.placeholder")}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={licenseBusy()}
                />
                <ButtonV2
                  size="normal"
                  variant="contrast"
                  data-action="settings-license-activate"
                  disabled={!licenseKeyInput().trim() || licenseBusy()}
                  onClick={() => void activateLicense()}
                >
                  {language.t("settings.license.activate.button")}
                </ButtonV2>
              </div>
            </SettingsRowV2>
          </Show>
        </SettingsListV2>
      </div>
    </Show>
  )
}
