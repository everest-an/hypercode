import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { SERVER_USERNAME } from "./server-credentials"

const desktopSrc = join(import.meta.dir, "..")
const engineAuth = join(import.meta.dir, "..", "..", "..", "opencode", "src", "server", "auth.ts")

describe("sidecar basic-auth username", () => {
  // v1 passes the username to Server.listen() explicitly, so it is self-consistent by construction. The v2
  // and WSL paths do not: their server is started by the bundled CLI, which resolves this default. If the
  // engine ever changes it, those two paths start answering 401 to a renderer that has no way to know.
  test("matches the default the engine resolves for OPENCODE_SERVER_USERNAME", async () => {
    const source = await readFile(engineAuth, "utf8")
    const matched = source.match(/OPENCODE_SERVER_USERNAME"\)[\s\S]{0,120}?withDefault\(\s*"([^"]+)"/)
    expect(matched, `could not find the OPENCODE_SERVER_USERNAME default in ${engineAuth}`).not.toBeNull()
    expect(SERVER_USERNAME).toBe(matched![1])
  })

  // The failure this guards against is a rebrand sweep, which finds string literals — not the constant.
  // v0.1.8 shipped exactly that: `username: "hypercode"` on the two paths that answer the renderer, while
  // the server kept starting as "opencode". Nothing failed loudly; the UI just never connected.
  test("is the only username literal in the desktop sources", async () => {
    const offenders: string[] = []
    for await (const relative of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: desktopSrc })) {
      // Tests are not shipped, and their fixtures may name a username on purpose — including this file,
      // which quotes the v0.1.8 literal verbatim in the comment above.
      if (/\.test\.tsx?$/.test(relative)) continue
      const source = await readFile(join(desktopSrc, relative), "utf8")
      for (const match of source.matchAll(/username:\s*"([^"]*)"/g)) {
        if (match[1] === SERVER_USERNAME) continue
        offenders.push(`${relative}: username: "${match[1]}"`)
      }
    }
    expect(
      offenders,
      `these must use SERVER_USERNAME — the engine compares usernames with strict equality:\n${offenders.join("\n")}`,
    ).toEqual([])
  })
})
