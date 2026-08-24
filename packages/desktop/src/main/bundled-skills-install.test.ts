import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fs from "node:fs/promises"
import { installSkillsFrom, NAMESPACE_PREFIX, VERSION_MARKER } from "./bundled-skills-install"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const GROUPS = ["finance", "legal", "academic"]

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "hypercode-skills-"))
  roots.push(root)
  const source = join(root, "resources", "skills")
  for (const group of GROUPS) {
    await mkdir(join(source, group, "one"), { recursive: true })
    await writeFile(join(source, group, "one", "SKILL.md"), `# ${group}`)
  }
  return { source, dest: join(root, "config", "skills") }
}

function collectLog() {
  const warnings: string[] = []
  const messages: string[] = []
  return { warnings, messages, log: (m: string) => messages.push(m), warn: (m: string) => warnings.push(m) }
}

const marker = (dest: string) => readFile(join(dest, VERSION_MARKER), "utf8").catch(() => undefined)
const installedGroups = (dest: string) => GROUPS.filter((g) => existsSync(join(dest, `${NAMESPACE_PREFIX}${g}`)))

/** Fails one named group, copies the rest for real. Stands in for a full disk or an antivirus lock. */
function copyFailing(group: string) {
  return (from: string, to: string) => {
    if (from.endsWith(group)) return Promise.reject(new Error("ENOSPC: no space left on device"))
    return fs.cp(from, to, { recursive: true, verbatimSymlinks: true })
  }
}

describe("installSkillsFrom", () => {
  test("installs every group and records the payload", async () => {
    const { source, dest } = await setup()
    const log = collectLog()

    const result = await installSkillsFrom({ source, dest, version: "0.1.12", log })

    expect(result).toMatchObject({ installed: 3, failed: 0, stamped: true })
    expect(installedGroups(dest)).toEqual(GROUPS)
    expect((await marker(dest))?.trim()).toMatch(/^0\.1\.12\|[0-9a-f]{16}$/)
    expect(log.warnings).toEqual([])
  })

  // The bug: the marker was written whenever *one* group landed, so a single failure left the library
  // permanently short — the next launch took the version fast path and never retried.
  test("does not claim the payload is installed when a group fails", async () => {
    const { source, dest } = await setup()
    const log = collectLog()

    const result = await installSkillsFrom({ source, dest, version: "0.1.12", log, copy: copyFailing("legal") })

    expect(result).toMatchObject({ installed: 2, failed: 1, stamped: false })
    // What did land stays — partial skills beat none, and the retry replaces them.
    expect(installedGroups(dest)).toEqual(["finance", "academic"])
    expect(await marker(dest)).toBeUndefined()
    expect(log.warnings).toContain("bundled skills incomplete, will reinstall on next launch")
  })

  test("retries everything on the next launch after a partial failure", async () => {
    const { source, dest } = await setup()

    await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog(), copy: copyFailing("legal") })
    const retry = await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog() })

    expect(retry).toMatchObject({ installed: 3, failed: 0, stamped: true, skipped: false })
    expect(installedGroups(dest)).toEqual(GROUPS)
  })

  // Clearing the marker matters more than merely not writing one. A previous version's marker left in place
  // would still name a fingerprint, and on the launch after that the "already current" branch would restamp
  // and skip the retry — so the failure would survive being noticed.
  //
  // Reaching this needs the payload to have actually changed; when it has not, skipping is correct and
  // there is nothing to retry.
  test("a partial failure clears the marker left by an earlier version", async () => {
    const { source, dest } = await setup()
    await installSkillsFrom({ source, dest, version: "0.1.11", log: collectLog() })
    expect(await marker(dest)).toBeDefined()
    await writeFile(join(source, "legal", "one", "SKILL.md"), "# legal, revised in 0.1.12")

    await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog(), copy: copyFailing("legal") })

    expect(await marker(dest)).toBeUndefined()
    const retry = await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog() })
    expect(retry).toMatchObject({ installed: 3, failed: 0, skipped: false })
    expect(await readFile(join(dest, `${NAMESPACE_PREFIX}legal`, "one", "SKILL.md"), "utf8")).toBe(
      "# legal, revised in 0.1.12",
    )
  })

  test("does nothing when the same version is already recorded", async () => {
    const { source, dest } = await setup()
    await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog() })

    const again = await installSkillsFrom({
      source,
      dest,
      version: "0.1.12",
      log: collectLog(),
      copy: () => Promise.reject(new Error("must not copy on the fast path")),
    })

    expect(again.skipped).toBe(true)
  })

  test("restamps without copying when only the app version moved", async () => {
    const { source, dest } = await setup()
    await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog() })

    const upgraded = await installSkillsFrom({
      source,
      dest,
      version: "0.1.13",
      log: collectLog(),
      copy: () => Promise.reject(new Error("payload is unchanged, nothing should be copied")),
    })

    expect(upgraded).toMatchObject({ skipped: true, stamped: true })
    expect((await marker(dest))?.trim()).toStartWith("0.1.13|")
  })

  test("copies again when the payload itself changed", async () => {
    const { source, dest } = await setup()
    await installSkillsFrom({ source, dest, version: "0.1.12", log: collectLog() })
    await writeFile(join(source, "finance", "one", "SKILL.md"), "# finance, revised and longer")

    const changed = await installSkillsFrom({ source, dest, version: "0.1.13", log: collectLog() })

    expect(changed).toMatchObject({ installed: 3, failed: 0, skipped: false })
    expect(await readFile(join(dest, `${NAMESPACE_PREFIX}finance`, "one", "SKILL.md"), "utf8")).toBe(
      "# finance, revised and longer",
    )
  })

  test("reports progress against the real group total", async () => {
    const { source, dest } = await setup()
    const seen: [number, number][] = []

    await installSkillsFrom({
      source,
      dest,
      version: "0.1.12",
      log: collectLog(),
      onProgress: (done, total) => seen.push([done, total]),
    })

    expect(seen).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })
})
