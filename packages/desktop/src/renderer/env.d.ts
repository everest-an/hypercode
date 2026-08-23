import type { ElectronAPI } from "../preload/types"

// Vite resolves asset imports to a URL string at build time.
declare module "*.png" {
  const src: string
  export default src
}

declare global {
  interface Window {
    api: ElectronAPI
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
