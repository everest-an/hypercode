import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"
import { openWithRecovery, type StoreRecoveryReport } from "./store-recovery"

const cache = new Map<string, Store>()

// Recovery reporting is wired in rather than imported, and buffered until it is.
//
// Importing ./logging here would pull electron's named exports into every module that touches the store,
// including ones whose tests deliberately avoid electron — wsl/servers.ts reads the store and its test then
// fails to load at all. Buffering also removes the ordering trap: a recovery that happens before anything
// has subscribed is replayed rather than lost, which matters because this is the one failure whose whole
// problem was leaving no trace.
const pendingRecoveries: StoreRecoveryReport[] = []
let recoveryListener: ((report: StoreRecoveryReport) => void) | undefined

export function onStoreRecovery(listener: (report: StoreRecoveryReport) => void) {
  recoveryListener = listener
  for (const report of pendingRecoveries.splice(0)) listener(report)
}

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const cwd = electron.app.getPath("userData")
  const options = { name, cwd, fileExtension: "", accessPropertiesByDotNotation: false }

  // An unreadable settings file used to end the launch outright, with no window and no log — see
  // openWithRecovery. Not hypothetical: userData lives under Roaming, so roaming-profile and OneDrive sync
  // both touch this file, as does any antivirus that scans it mid-write.
  const next = openWithRecovery({
    file: join(cwd, name),
    open: () => new Store(options),
    onRecover: (report) => (recoveryListener ? recoveryListener(report) : pendingRecoveries.push(report)),
  })

  cache.set(name, next)
  return next
}

export async function removeStoreFileIfEmpty(name: string) {
  if (await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name)) cache.delete(name)
}

export function removeStoreFile(name: string) {
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
