// @ts-nocheck
// Visual regression stories for the trial/subscribe prompt.
// The launch dialog is opened by the component itself; with a DialogProvider
// wrapping the story it renders here too (after ~600ms).
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { setPlatform } from "@/context/platform"
import { LicenseNotice } from "./license-notice"

const basePlatform = {
  platform: "desktop",
  os: "macos",
  version: "0.1.0",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
  fetch: globalThis.fetch.bind(globalThis),
  getPinchZoomEnabled: () => false,
  setPinchZoomEnabled: () => {},
}

function makeLicense(status) {
  return {
    getStatus: async () => status,
    activate: async () => status,
    clear: async () => status,
  }
}

function render(status) {
  setPlatform({ ...basePlatform, license: makeLicense(status) })
  return (
    <DialogProvider>
      <div style={{ width: "720px", height: "120px", position: "relative" }}>
        <LicenseNotice />
      </div>
    </DialogProvider>
  )
}

export default {
  title: "App/License notice",
  id: "app-license-notice",
}

/** Trial ending within the window: banner only. */
export const Expiring = () =>
  render({
    decision: { mode: "trial", daysLeft: 2 },
    hasKey: false,
    machineId: "machine-0001",
    keySuffix: null,
    verifyKind: "not-tried",
    verifyError: null,
    needsAttention: true,
  })

/** Trial over, no key: banner + launch dialog. */
export const Expired = () =>
  render({
    decision: { mode: "trial", daysLeft: -1 },
    hasKey: false,
    machineId: "machine-0001",
    keySuffix: null,
    verifyKind: "not-tried",
    verifyError: null,
    needsAttention: true,
  })

/** Licensed: nothing renders. */
export const Active = () =>
  render({
    decision: { mode: "licensed", plan: "pro_monthly", expiresAt: null },
    hasKey: true,
    machineId: "machine-0001",
    keySuffix: "CFB4",
    verifyKind: "valid",
    verifyError: null,
    needsAttention: false,
  })
