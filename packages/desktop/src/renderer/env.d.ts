import type { ElectronNative } from "../preload/types"

// Vite resolves asset imports to a URL string at build time.
declare module "*.png" {
  const src: string
  export default src
}

declare global {
  interface ImportMetaEnv {
    readonly OPENCODE_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
