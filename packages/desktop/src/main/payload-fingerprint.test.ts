import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fingerprintTree } from "./payload-fingerprint"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "hypercode-fingerprint-"))
  roots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative)
    await mkdir(join(full, ".."), { recursive: true })
    await writeFile(full, content)
  }
  return root
}

const LIBRARY = {
  "finance/dcf/SKILL.md": "# DCF\nbuild a discounted cash flow model",
  "finance/dcf/assets/template.csv": "a,b,c",
  "legal/nda/SKILL.md": "# NDA\nreview a non-disclosure agreement",
}

describe("fingerprintTree", () => {
  test("two copies of the same content agree", async () => {
    expect(await fingerprintTree(await tree(LIBRARY))).toBe(await fingerprintTree(await tree(LIBRARY)))
  })

  // The whole point is to survive a rebuild. CI checks out fresh, so every file's mtime differs on every
  // build; if those fed the digest it would never match and each update would recopy the payload — exactly
  // the behaviour this replaces, but now costing an extra walk on top.
  test("ignores timestamps", async () => {
    const root = await tree(LIBRARY)
    const before = await fingerprintTree(root)
    const past = new Date("2020-01-01T00:00:00Z")
    await utimes(join(root, "finance/dcf/SKILL.md"), past, past)

    expect(await fingerprintTree(root)).toBe(before)
  })

  test("moves when a file's content changes size", async () => {
    const root = await tree(LIBRARY)
    const before = await fingerprintTree(root)
    await writeFile(join(root, "legal/nda/SKILL.md"), "# NDA\nreview a non-disclosure agreement, carefully")

    expect(await fingerprintTree(root)).not.toBe(before)
  })

  test("moves when a file is added, removed, or renamed", async () => {
    const base = await fingerprintTree(await tree(LIBRARY))

    const added = await fingerprintTree(await tree({ ...LIBRARY, "legal/msa/SKILL.md": "# MSA" }))
    expect(added).not.toBe(base)

    const { "legal/nda/SKILL.md": removed, ...without } = LIBRARY
    expect(await fingerprintTree(await tree(without))).not.toBe(base)

    const { "legal/nda/SKILL.md": moved, ...rest } = LIBRARY
    expect(await fingerprintTree(await tree({ ...rest, "legal/mutual-nda/SKILL.md": moved }))).not.toBe(base)
  })

  // Pins the digest to "sha256 of sorted <relpath>:<size> lines, first 16 hex chars".
  //
  // The sort inside fingerprintTree exists because filesystems do not promise readdir ordering, and an
  // unsorted walk would digest the same tree differently on different machines — turning every launch into a
  // full recopy. Be aware that this test cannot prove the sort is there: NTFS returns directory entries
  // already ordered, so deleting the sort keeps every assertion in this file green (verified by mutation).
  // What it does pin is the format, so the algorithm cannot drift silently and a reader can recompute it.
  test("is the sha256 of the sorted path:size list", async () => {
    const root = await tree({ "b/SKILL.md": "two", "a/SKILL.md": "one", "a/notes.md": "three" })

    const expected = createHash("sha256")
      .update(["a/SKILL.md:3", "a/notes.md:5", "b/SKILL.md:3"].join("\n"))
      .digest("hex")
      .slice(0, 16)
    expect(await fingerprintTree(root)).toBe(expected)
  })

  // Callers treat undefined as "cannot vouch for this" and fall back to copying, which is why it must not
  // be confused with a real digest.
  test("returns undefined for a tree that cannot be read", async () => {
    expect(await fingerprintTree(join(tmpdir(), "hypercode-fingerprint-does-not-exist"))).toBeUndefined()
  })
})
