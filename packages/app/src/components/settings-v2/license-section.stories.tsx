// @ts-nocheck
// Visual regression story for the HyperCode Pro license panel.
// Uses the storybook platform mock so the desktop-only panel renders in isolation.
import { setPlatform } from "@/context/platform"
import { SettingsLicenseV2 } from "./license-section"

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
    <div style={{ width: "640px" }}>
      <SettingsLicenseV2 />
    </div>
  )
}

export default {
  title: "App/Settings/License",
  id: "app-settings-license",
}

/** Fresh install: trial running, no key entered yet. */
export const Trial = () =>
  render({
    decision: { mode: "trial", daysLeft: 5 },
    hasKey: false,
    machineId: "machine-0001",
    keySuffix: null,
    verifyKind: "not-tried",
    verifyError: null,
    needsAttention: true,
  })

/** Active subscription: key verified, plan shown, activation row hidden. */
export const Licensed = () =>
  render({
    decision: { mode: "licensed", plan: "pro_monthly", expiresAt: "2026-10-07T00:00:00Z" },
    hasKey: true,
    machineId: "machine-0001",
    keySuffix: "CFB4",
    verifyKind: "valid",
    verifyError: null,
    needsAttention: false,
  })

/** Trial ended with no valid key: subscribe prompt + activation entry. */
export const Expired = () =>
  render({
    decision: { mode: "expired" },
    hasKey: false,
    machineId: "machine-0001",
    keySuffix: null,
    verifyKind: "invalid",
    verifyError: null,
    needsAttention: true,
  })
