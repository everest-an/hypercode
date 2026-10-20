import { createMemo } from "solid-js"

import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { PluginUpdaterState } from "@/plugin-updater"
import { showToast } from "@/utils/toast"

export function pluginUpdaterAction(state: PluginUpdaterState | undefined) {
  if (!state) return { label: "settings.updates.action.checkNow" as const }
  switch (state.status) {
    case "checking":
      return { label: "settings.updates.action.checking" as const }
    case "installing":
      return { label: "settings.updates.action.installing" as const }
    case "available":
      return { label: "settings.updates.action.installPlugin" as const, run: "install" as const }
    case "ready":
      return { label: "settings.updates.action.installedRestart" as const }
    case "disabled":
      return { label: "settings.updates.action.checkNow" as const }
    default:
      return { label: "settings.updates.action.checkNow" as const, run: "check" as const }
  }
}

export function usePluginUpdaterAction() {
  const platform = usePlatform()
  const language = useLanguage()
  const action = createMemo(() => pluginUpdaterAction(platform.pluginUpdater?.state()))

  return {
    action,
    async run() {
      const run = action().run
      if (run === "install") return platform.pluginUpdater?.install()
      if (run !== "check") return undefined

      const state = await platform.pluginUpdater?.check()
      if (state?.status === "up-to-date") {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.updates.toast.pluginLatest.title"),
          description: language.t("settings.updates.toast.pluginLatest.description"),
        })
      }
      if (state?.status === "error") {
        showToast({ title: language.t("common.requestFailed"), description: state.message })
      }
      if (state?.status === "incompatible") {
        showToast({
          title: language.t("settings.updates.toast.pluginIncompatible.title"),
          description: language.t("settings.updates.toast.pluginIncompatible.description"),
          })
        }
        return undefined
      },
      revert: () => platform.pluginUpdater?.revert(),
  }
}
