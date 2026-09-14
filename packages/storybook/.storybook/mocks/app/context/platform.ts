import type { Platform } from "../../../../../app/src/context/platform"

let value: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
  fetch: globalThis.fetch.bind(globalThis),
}

/** Storybook-only override so a story can render desktop-only surfaces. */
export function setPlatform(next: Platform) {
  value = next
}

export function usePlatform() {
  return value
}
