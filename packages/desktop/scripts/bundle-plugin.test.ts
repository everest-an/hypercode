import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pruneTree } from "./bundle-plugin"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function file(path: string, contents = "x") {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, contents)
}

/** Mirrors the shapes that actually show up in the staged tree, including the ones that must survive. */
async function tree() {
  const root = await mkdtemp(join(tmpdir(), "hypercode-prune-"))
  roots.push(root)
  const modules = join(root, "node_modules")

  // The plugin itself: documentation rules must not touch it, source maps still go.
  await file(join(modules, "oh-my-openagent", "package.json"))
  await file(join(modules, "oh-my-openagent", "README.md"))
  await file(join(modules, "oh-my-openagent", "prompts", "sisyphus.md"))
  await file(join(modules, "oh-my-openagent", "docs", "usage.md"))
  await file(join(modules, "oh-my-openagent", "dist", "index.js"))
  await file(join(modules, "oh-my-openagent", "dist", "index.js.map"))

  // An ordinary dependency: docs and tests go, licences stay.
  await file(join(modules, "dep", "index.js"))
  await file(join(modules, "dep", "README.md"))
  await file(join(modules, "dep", "LICENSE"))
  await file(join(modules, "dep", "LICENSE.md"))
  await file(join(modules, "dep", "NOTICE.md"))
  await file(join(modules, "dep", "test", "spec.js"))
  await file(join(modules, "dep", "docs", "guide.md"))
  await file(join(modules, "dep", "examples", "demo.js"))

  // Packages whose own names collide with the droppable-directory list.
  await file(join(modules, "test", "index.js"))
  await file(join(modules, "docs", "index.js"))
  await file(join(modules, "@scope", "examples", "index.js"))

  // Multi-platform native payload: only the build platform's directory can ever run.
  for (const platform of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]) {
    await file(join(modules, "@code-yeongyu", "comment-checker", "vendor", platform, "checker"))
  }
  await file(join(modules, "@code-yeongyu", "comment-checker", "vendor", "shared.json"))

  await file(join(modules, "typescript", "lib", "typescript.js"))

  return modules
}

test("keeps only the build platform's native payload", async () => {
  const modules = await tree()

  await pruneTree(modules, { platformDir: "win32-x64" })

  const vendor = join(modules, "@code-yeongyu", "comment-checker", "vendor")
  expect(existsSync(join(vendor, "win32-x64", "checker"))).toBe(true)
  expect(existsSync(join(vendor, "shared.json"))).toBe(true)
  for (const dropped of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]) {
    expect(existsSync(join(vendor, dropped))).toBe(false)
  }
})

test("drops documentation and fixture directories from dependencies", async () => {
  const modules = await tree()

  await pruneTree(modules, { platformDir: "win32-x64" })

  expect(existsSync(join(modules, "dep", "test"))).toBe(false)
  expect(existsSync(join(modules, "dep", "docs"))).toBe(false)
  expect(existsSync(join(modules, "dep", "examples"))).toBe(false)
  expect(existsSync(join(modules, "dep", "README.md"))).toBe(false)
  expect(existsSync(join(modules, "dep", "index.js"))).toBe(true)
})

// Deleting a licence would break the Apache-2.0 / MIT redistribution terms this repo just finished
// complying with, and LICENSE.md is otherwise a plain `*.md` hit.
test("never deletes licence text, including LICENSE.md", async () => {
  const modules = await tree()

  await pruneTree(modules, { platformDir: "win32-x64" })

  expect(existsSync(join(modules, "dep", "LICENSE"))).toBe(true)
  expect(existsSync(join(modules, "dep", "LICENSE.md"))).toBe(true)
  expect(existsSync(join(modules, "dep", "NOTICE.md"))).toBe(true)
})

// A dependency legitimately named `test` or `docs` is a package, not a fixture directory.
test("does not delete packages whose names collide with the droppable list", async () => {
  const modules = await tree()

  await pruneTree(modules, { platformDir: "win32-x64" })

  expect(existsSync(join(modules, "test", "index.js"))).toBe(true)
  expect(existsSync(join(modules, "docs", "index.js"))).toBe(true)
  expect(existsSync(join(modules, "@scope", "examples", "index.js"))).toBe(true)
})

// An agent orchestration plugin ships markdown it reads at runtime; stripping it would break the product.
test("leaves the plugin's own markdown alone but still drops its source maps", async () => {
  const modules = await tree()

  await pruneTree(modules, { platformDir: "win32-x64", preserveRoot: join(modules, "oh-my-openagent") })

  expect(existsSync(join(modules, "oh-my-openagent", "README.md"))).toBe(true)
  expect(existsSync(join(modules, "oh-my-openagent", "prompts", "sisyphus.md"))).toBe(true)
  expect(existsSync(join(modules, "oh-my-openagent", "docs", "usage.md"))).toBe(true)
  expect(existsSync(join(modules, "oh-my-openagent", "dist", "index.js"))).toBe(true)
  expect(existsSync(join(modules, "oh-my-openagent", "dist", "index.js.map"))).toBe(false)
})

test("keeps typescript unless explicitly asked to drop it", async () => {
  const kept = await tree()
  await pruneTree(kept, { platformDir: "win32-x64" })
  expect(existsSync(join(kept, "typescript"))).toBe(true)

  const dropped = await tree()
  await pruneTree(dropped, { platformDir: "win32-x64", dropTypescript: true })
  expect(existsSync(join(dropped, "typescript"))).toBe(false)
})
