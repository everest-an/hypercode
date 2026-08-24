import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openWithRecovery, type StoreRecoveryReport } from "./store-recovery"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function tempFile(contents?: string) {
  const root = mkdtempSync(join(tmpdir(), "hypercode-store-recovery-"))
  roots.push(root)
  const file = join(root, "opencode.settings")
  if (contents !== undefined) writeFileSync(file, contents)
  return file
}

/** Stands in for electron-store: throws while the file on disk is unparseable, succeeds once it is gone. */
function parsingOpen(file: string) {
  let attempts = 0
  return {
    attempts: () => attempts,
    open: () => {
      attempts++
      if (!existsSync(file)) return { fresh: true, data: {} }
      const raw = readFileSync(file, "utf8")
      return { fresh: false, data: JSON.parse(raw) as Record<string, unknown> }
    },
  }
}

describe("openWithRecovery", () => {
  test("returns the store untouched when the file reads fine", () => {
    const file = tempFile(`{"windowWidth":1280}`)
    const reports: StoreRecoveryReport[] = []
    const subject = parsingOpen(file)

    const store = openWithRecovery({ file, open: subject.open, onRecover: (r) => reports.push(r) })

    expect(store).toEqual({ fresh: false, data: { windowWidth: 1280 } })
    expect(subject.attempts()).toBe(1)
    // Nothing was moved and nothing was reported, because nothing went wrong.
    expect(reports).toEqual([])
    expect(existsSync(`${file}.corrupt`)).toBe(false)
  })

  // The failure this exists for: before it, a truncated file ended the launch with no window and no log,
  // on every launch, and the only cure was deleting a file the user has no reason to know about.
  test("recovers from an unreadable file and keeps it for inspection", () => {
    const file = tempFile("{ this is not json")
    const reports: StoreRecoveryReport[] = []
    const subject = parsingOpen(file)

    const store = openWithRecovery({ file, open: subject.open, onRecover: (r) => reports.push(r) })

    expect(store).toEqual({ fresh: true, data: {} })
    expect(subject.attempts()).toBe(2)
    // Moved aside, not deleted — it is the only evidence of what went wrong.
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(`${file}.corrupt`, "utf8")).toBe("{ this is not json")
    expect(reports).toHaveLength(1)
    expect(reports[0].salvagedOk).toBe(true)
    expect((reports[0].error as Error).name).toBe("SyntaxError")
  })

  test("overwrites an older salvaged copy instead of failing on it", () => {
    const file = tempFile("{ broken again")
    writeFileSync(`${file}.corrupt`, "from a previous incident")
    const subject = parsingOpen(file)

    openWithRecovery({ file, open: subject.open, onRecover: () => {} })

    expect(readFileSync(`${file}.corrupt`, "utf8")).toBe("{ broken again")
  })

  // A lock blocks the rename for the same reason it blocked the read. Recovery still runs, and the report
  // says the file could not be preserved rather than implying it was.
  test("reports when the unreadable file could not be moved aside", () => {
    const file = join(mkdtempSync(join(tmpdir(), "hypercode-store-recovery-")), "missing", "settings")
    roots.push(join(file, "..", ".."))
    const reports: StoreRecoveryReport[] = []
    let attempts = 0

    const store = openWithRecovery({
      file,
      open: () => {
        attempts++
        if (attempts === 1) throw new Error("EBUSY: resource busy or locked")
        return "opened"
      },
      onRecover: (r) => reports.push(r),
    })

    expect(store).toBe("opened")
    expect(reports[0].salvagedOk).toBe(false)
  })

  // If it fails twice the contents were never the problem, and swallowing that would turn a diagnosable
  // crash into a confusing one.
  test("rethrows when opening fails again after recovery", () => {
    const file = tempFile("{ broken")

    expect(() =>
      openWithRecovery({
        file,
        open: () => {
          throw new Error("EPERM: operation not permitted")
        },
        onRecover: () => {},
      }),
    ).toThrow("EPERM")
  })
})
