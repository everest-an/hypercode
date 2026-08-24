import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Identify a shipped payload by its shape: every file's path and size, walked in a stable order.
 *
 * Used to decide whether a bundled tree still matches the copy already installed. Keying that decision on
 * the app version instead meant every update recopied tens of megabytes that had not changed, which is most
 * of what a user experienced as a stalled first launch after upgrading.
 *
 * Deliberately not a content hash: reading 44 MB to avoid copying 44 MB saves nothing. Deliberately not
 * mtimes either — CI checks out fresh, so those differ on every build and the fingerprint would never match,
 * silently restoring the behaviour this replaces. Path+size is stable across rebuilds of identical content
 * and moves for anything that adds, removes, renames, or resizes a file.
 *
 * The gap is an edit that preserves every file's exact byte count. For a library of shipped documents that
 * is a content mistake we would catch elsewhere, not a corruption risk this needs to defend against.
 *
 * Returns undefined when the tree cannot be read, so callers fall back to copying rather than trusting a
 * fingerprint they could not compute.
 */
export async function fingerprintTree(root: string): Promise<string | undefined> {
  const parts: string[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    // Directory order is filesystem-defined; sort so the same tree always produces the same digest.
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const next = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), next)
        continue
      }
      const stat = await fs.stat(path.join(dir, entry.name))
      parts.push(`${next}:${stat.size}`)
    }
  }
  try {
    await walk(root, "")
  } catch {
    return undefined
  }
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16)
}
