import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Every i18n key the UI asks for must exist somewhere.
 *
 * A missing key does not throw — the translator hands back the key path, so the user reads
 * "dialog.provider.opencode.tagline" off the screen where a sentence should be. Nothing in the build or the
 * type checker notices, which is how four references to keys deleted by a branding sweep survived it.
 *
 * This is a source scan, not a runtime check, because the keys are referenced as string literals and there
 * is nothing else to hook.
 */

const appSrc = join(import.meta.dir, "..")
const uiEn = join(import.meta.dir, "..", "..", "..", "ui", "src", "i18n", "en.ts")

/** Every key defined in a bundle, taken from its `"some.key":` entries. */
function definedIn(file: string) {
  return new Set([...readFileSync(file, "utf8").matchAll(/"([a-zA-Z0-9_.]+)":/g)].map((m) => m[1]))
}

/**
 * Keys the code asks for.
 *
 * Only literal single-argument calls: `t("a.b")` and `language.t("a.b")`. Keys built at runtime cannot be
 * checked this way, and pretending otherwise would mean either false alarms or a weaker rule.
 */
function referencedKeys() {
  const found = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        // The bundles themselves define keys, they do not consume them.
        if (entry.name !== "i18n") walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
      const source = readFileSync(full, "utf8")
      for (const match of source.matchAll(/\bt\(\s*"([a-z][a-zA-Z0-9_.]*\.[a-zA-Z0-9_.]+)"/g)) {
        if (!found.has(match[1])) found.set(match[1], full.slice(appSrc.length + 1))
      }
    }
  }
  walk(appSrc)
  return found
}

describe("i18n references", () => {
  test("every key the UI asks for is defined in some bundle", () => {
    // Three bundles are in play: the app's own, the shared ui package's, and the desktop native strings
    // the main process renders before a renderer exists.
    const defined = new Set([
      ...definedIn(join(import.meta.dir, "en.ts")),
      ...definedIn(join(import.meta.dir, "desktop-native.ts")),
      ...definedIn(uiEn),
    ])

    const missing = [...referencedKeys()]
      .filter(([key]) => !defined.has(key))
      .map(([key, file]) => `${key}  (${file})`)

    expect(
      missing,
      `these render as their own key path to the user:\n  ${missing.join("\n  ")}`,
    ).toEqual([])
  })
})
