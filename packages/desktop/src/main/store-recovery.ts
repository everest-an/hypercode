import { renameSync, rmSync } from "node:fs"

export type StoreRecoveryReport = {
  file: string
  salvaged: string
  error: unknown
  /** False when the unreadable file could not be moved aside — usually the same lock that blocked reading. */
  salvagedOk: boolean
}

/**
 * Open a store, surviving a file that cannot be read.
 *
 * electron-store parses during construction and re-throws anything that is not ENOENT — conf defaults
 * `clearInvalidConfig` to false. A truncated or momentarily locked settings file therefore ended the launch,
 * and because the first store access happens before the logger exists, it did so with no window, no dialog
 * and no log. Every subsequent launch did the same. Recovery meant knowing to delete a file the user has no
 * reason to know exists.
 *
 * The unreadable file is moved aside rather than deleted. `clearInvalidConfig: true` would have been one
 * option less, but it discards the user's settings silently and leaves nothing to inspect afterwards.
 *
 * A second failure is rethrown: at that point the problem is not the file's contents, and pretending
 * otherwise would trade a diagnosable crash for a confusing one.
 */
export function openWithRecovery<T>(input: {
  /** Absolute path of the store file, used only to move it aside. */
  file: string
  open: () => T
  onRecover: (report: StoreRecoveryReport) => void
}): T {
  try {
    return input.open()
  } catch (error) {
    const salvaged = `${input.file}.corrupt`
    let salvagedOk = true
    try {
      rmSync(salvaged, { force: true })
      renameSync(input.file, salvaged)
    } catch {
      salvagedOk = false
    }
    input.onRecover({ file: input.file, salvaged, error, salvagedOk })
    // With the file gone the retry sees ENOENT, which electron-store treats as a first run.
    return input.open()
  }
}
