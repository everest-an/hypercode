import { expect, test } from "bun:test"

// draft-store.ts imports node:sqlite, which only exists in the Electron main
// process (Node 24). Bun has no node:sqlite builtin as of 1.3.14, so importing
// it at module scope throws and takes the whole file down. Probe first and skip
// instead — this file was silently red for as long as packages/desktop had no
// "test" script, and enabling that script must not hand CI a permanent failure.
const hasNodeSqlite = await (async () => {
  try {
    await import("node:sqlite")
    return true
  } catch {
    return false
  }
})()

test.skipIf(!hasNodeSqlite)("flushes the latest buffered draft and stores blobs", async () => {
  const { createDesktopDraftStore } = await import("./draft-store")
  const store = createDesktopDraftStore(":memory:")
  store.set("prompt", "first")
  store.set("prompt", "latest")
  expect(store.get("prompt")).toBe("latest")
  store.flush()
  expect(store.get("prompt")).toBe("latest")

  const bytes = new TextEncoder().encode("image")
  const id = store.putBlob(bytes)
  expect(store.getBlob(id)).toEqual(bytes)
  store.close()
})
