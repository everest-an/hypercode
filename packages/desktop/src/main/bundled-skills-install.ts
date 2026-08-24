import fs from "node:fs/promises"
import path from "node:path"

import { fingerprintTree } from "./payload-fingerprint"

/** Marks the system-managed zone. Anything the user creates outside this prefix is never touched. */
export const NAMESPACE_PREFIX = "hypercode-"
export const VERSION_MARKER = ".hypercode-bundled-version"

export type InstallSkillsOptions = {
  /** The shipped library, either from resources/ or the repo in an unpackaged run. */
  source: string
  /** `<config>/skills`. */
  dest: string
  version: string
  log: {
    log: (message: string, extra?: unknown) => void
    warn: (message: string, extra?: unknown) => void
  }
  /** Reports group counts. The total is known here, unlike the plugin payload. */
  onProgress?: (done: number, total: number) => void
  /**
   * Seam for tests: how one group is staged. Defaults to fs.cp.
   *
   * Exists because the behaviour worth testing here is what happens when a group *fails* — a full disk, a
   * permission error, an antivirus lock — and provoking those for real is neither portable nor reliable.
   */
  copy?: (from: string, to: string) => Promise<void>
}

export type InstallSkillsResult = {
  /** Groups now in place. */
  installed: number
  /** Groups that could not be written this run. */
  failed: number
  /** True when the marker claims this payload is fully installed. */
  stamped: boolean
  /** True when the copy was skipped because the payload was already current. */
  skipped: boolean
}

/**
 * Copy the bundled skill library into the user's config directory.
 *
 * Two stages decide whether any copying is needed at all, because the two cheap answers are cheap for
 * different reasons. Keying on the app version alone meant every update recopied ~44 MB that had not
 * changed; fingerprinting on every launch would add ~650 ms to an ordinary launch that needs to do nothing.
 * So the version is the free fast path, and the fingerprint only runs when that misses.
 *
 * The marker is written only when every group lands. It used to be written whenever *one* group did, which
 * meant a single permission error or a full disk left the library permanently short: the next launch took
 * the version fast path, returned immediately, and the missing groups were never retried until the app
 * version happened to change. A partial run now clears the marker instead, so the next launch redoes the
 * whole set — slower than resuming, but the alternative is a product that silently ships without the skills
 * it is sold on.
 *
 * Clearing rather than merely not-writing matters: leaving the old marker in place would let the
 * "already current" fingerprint branch above skip the retry too.
 */
export async function installSkillsFrom(options: InstallSkillsOptions): Promise<InstallSkillsResult> {
  const { source, dest, version, log } = options
  // verbatimSymlinks for the same reason scripts/bundle-plugin.ts needs it: without it a symlink is
  // rewritten as an absolute path into the app bundle, which breaks the moment the app is updated.
  const copy = options.copy ?? ((from, to) => fs.cp(from, to, { recursive: true, verbatimSymlinks: true }))
  const marker = path.join(dest, VERSION_MARKER)
  const idle: InstallSkillsResult = { installed: 0, failed: 0, stamped: false, skipped: true }

  const installed = await fs.readFile(marker, "utf8").catch(() => undefined)
  const [installedVersion, installedFingerprint] = (installed ?? "").trim().split("|")
  if (installedVersion === version) return idle

  const fingerprint = await fingerprintTree(source)
  if (installedFingerprint && fingerprint && installedFingerprint === fingerprint) {
    // Same payload under a new app version. Restamp so the next launch takes the free fast path again.
    await fs.writeFile(marker, `${version}|${fingerprint}\n`, "utf8").catch(() => {})
    log.log("bundled skills already current", { dest })
    return { ...idle, stamped: true }
  }

  const groups = await fs.readdir(source, { withFileTypes: true }).catch(() => [])
  const dirs = groups.filter((entry) => entry.isDirectory())
  if (dirs.length === 0) return idle

  await fs.mkdir(dest, { recursive: true })
  let count = 0
  let failed = 0
  // Announced only once a copy is known to be needed: the early returns above are the common case and must
  // not flash a preparation screen on an ordinary launch.
  options.onProgress?.(0, dirs.length)
  for (const entry of dirs) {
    const target = path.join(dest, `${NAMESPACE_PREFIX}${entry.name}`)
    // Replace the namespace wholesale rather than merging, so a skill removed upstream does not linger.
    // Write to a sibling first and swap, so an interrupted copy cannot leave a half-written namespace that
    // the engine would then try to load.
    const staging = `${target}.incoming`
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    const copied = await copy(path.join(source, entry.name), staging)
      .then(() => true)
      .catch((error) => {
        log.warn("failed to stage bundled skills", { group: entry.name, error })
        return false
      })
    if (!copied) {
      failed++
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
      options.onProgress?.(count, dirs.length)
      continue
    }
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    const swapped = await fs
      .rename(staging, target)
      .then(() => true)
      .catch((error) => {
        log.warn("failed to install bundled skills", { group: entry.name, error })
        return false
      })
    if (swapped) count++
    else {
      failed++
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    }
    options.onProgress?.(count, dirs.length)
  }

  if (failed > 0) {
    // No marker at all, so neither the version fast path nor the fingerprint branch can skip the retry.
    await fs.rm(marker, { force: true }).catch(() => {})
    log.warn("bundled skills incomplete, will reinstall on next launch", {
      installed: count,
      failed,
      dest,
    })
    return { installed: count, failed, stamped: false, skipped: false }
  }

  if (count === 0) return { installed: 0, failed: 0, stamped: false, skipped: false }

  await fs.writeFile(marker, `${version}|${fingerprint}\n`, "utf8").catch((error) => {
    // Losing the marker only costs a redundant copy next launch; the skills themselves are in place.
    log.warn("failed to record bundled skill version", error)
  })
  log.log("installed bundled skills", { groups: count, dest })
  return { installed: count, failed: 0, stamped: true, skipped: false }
}
