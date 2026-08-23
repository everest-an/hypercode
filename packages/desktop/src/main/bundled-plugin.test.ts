import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BUNDLED_PLUGIN_PACKAGE, resolveBundledPluginSource, seedBundledPlugin } from "./bundled-plugin"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "hypercode-bundled-plugin-"))
  roots.push(root)
  return root
}

function collectLog() {
  const warnings: string[] = []
  const messages: string[] = []
  return {
    warnings,
    messages,
    log: (message: string) => messages.push(message),
    warn: (message: string) => warnings.push(message),
  }
}

/** A miniature stand-in for the staged install: one plugin package plus one transitive dependency. */
async function payload(root: string) {
  const source = join(root, "payload")
  const pkg = join(source, "node_modules", BUNDLED_PLUGIN_PACKAGE)
  await mkdir(join(pkg, "dist"), { recursive: true })
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: BUNDLED_PLUGIN_PACKAGE, main: "dist/index.js" }))
  await writeFile(join(pkg, "dist", "index.js"), "export default {}")
  await mkdir(join(source, "node_modules", "some-dep"), { recursive: true })
  await writeFile(join(source, "node_modules", "some-dep", "index.js"), "module.exports = 1")
  await writeFile(join(source, "package.json"), JSON.stringify({ name: "hypercode-plugin-payload" }))
  return source
}

async function setup(root: string) {
  const cacheDir = join(root, "cache")
  const configDir = join(root, "config")
  await mkdir(configDir, { recursive: true })
  return { source: await payload(root), cacheDir, configDir }
}

describe("seedBundledPlugin", () => {
  test("seeds both cache specs the engine can ask for, and lists the plugin in a fresh config", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)
    const log = collectLog()

    const result = await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log })

    // v1 rewrites a bare name to "<name>@latest" and v2 does not; each spec is its own cache directory.
    expect(result.seeded).toEqual([`${BUNDLED_PLUGIN_PACKAGE}@latest`, BUNDLED_PLUGIN_PACKAGE])
    for (const spec of [`${BUNDLED_PLUGIN_PACKAGE}@latest`, BUNDLED_PLUGIN_PACKAGE]) {
      // This exact path is what Npm.add stats before deciding to hit the network.
      expect(existsSync(join(cacheDir, "packages", spec, "node_modules", BUNDLED_PLUGIN_PACKAGE))).toBe(true)
      expect(existsSync(join(cacheDir, "packages", spec, "node_modules", "some-dep", "index.js"))).toBe(true)
    }
    expect(result.configured).toBe(true)
    const config = await readFile(join(configDir, "hypercode.jsonc"), "utf8")
    expect(JSON.parse(config)).toEqual({ plugin: [BUNDLED_PLUGIN_PACKAGE] })
    expect(log.warnings).toEqual([])
  })

  test("leaves no staging directory behind", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)

    await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })

    expect(existsSync(join(cacheDir, "packages", `${BUNDLED_PLUGIN_PACKAGE}@latest.incoming`))).toBe(false)
  })

  test("is idempotent across launches at the same version", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)

    await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })
    const second = await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })

    expect(second.seeded).toEqual([])
    const config = await readFile(join(configDir, "hypercode.jsonc"), "utf8")
    expect(JSON.parse(config).plugin).toEqual([BUNDLED_PLUGIN_PACKAGE])
  })

  test("re-seeds when the app version changes", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)

    await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })
    const upgraded = await seedBundledPlugin({ source, cacheDir, configDir, version: "1.3.0", log: collectLog() })

    expect(upgraded.seeded).toEqual([`${BUNDLED_PLUGIN_PACKAGE}@latest`, BUNDLED_PLUGIN_PACKAGE])
  })

  test("replaces a half-written cache directory left by an interrupted install", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)
    const target = join(cacheDir, "packages", `${BUNDLED_PLUGIN_PACKAGE}@latest`)
    await mkdir(join(target, "node_modules", ".package-lock.json"), { recursive: true })

    await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })

    expect(existsSync(join(target, "node_modules", BUNDLED_PLUGIN_PACKAGE, "dist", "index.js"))).toBe(true)
  })

  test("does nothing at all when the build shipped no payload", async () => {
    const root = await tempRoot()
    const { cacheDir, configDir } = await setup(root)
    const log = collectLog()

    const result = await seedBundledPlugin({ source: undefined, cacheDir, configDir, version: "1.2.3", log })

    expect(result).toEqual({ seeded: [], configured: false })
    expect(existsSync(join(configDir, "hypercode.jsonc"))).toBe(false)
    expect(log.warnings).toEqual([])
  })

  test("warns and skips the config edit when the payload is incomplete", async () => {
    const root = await tempRoot()
    const { cacheDir, configDir } = await setup(root)
    const empty = join(root, "empty")
    await mkdir(empty, { recursive: true })
    const log = collectLog()

    const result = await seedBundledPlugin({ source: empty, cacheDir, configDir, version: "1.2.3", log })

    // Listing a plugin whose tree is not on disk is worse than not listing it: it hands the user the exact
    // multi-minute stall this module exists to remove.
    expect(result).toEqual({ seeded: [], configured: false })
    expect(existsSync(join(configDir, "hypercode.jsonc"))).toBe(false)
    expect(log.warnings).toEqual(["bundled plugin payload is incomplete"])
  })
})

describe("seedBundledPlugin config handling", () => {
  test("edits the config the engine would actually read, keeping its comments", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)
    // hypercode.json wins over opencode.json in globalConfigFile()'s candidate order.
    await writeFile(join(configDir, "opencode.json"), "{}")
    await writeFile(
      join(configDir, "hypercode.json"),
      `{\n  // 由安装向导自动生成\n  "model": "deepseek/deepseek-v4-pro"\n}\n`,
    )

    await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })

    const config = await readFile(join(configDir, "hypercode.json"), "utf8")
    expect(config).toContain("// 由安装向导自动生成")
    expect(config).toContain(`"${BUNDLED_PLUGIN_PACKAGE}"`)
    expect(await readFile(join(configDir, "opencode.json"), "utf8")).toBe("{}")
  })

  test("extends the v2 key when the document already uses it", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)
    await writeFile(join(configDir, "hypercode.json"), `{ "plugins": ["other"] }`)

    await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })

    const config = JSON.parse(await readFile(join(configDir, "hypercode.json"), "utf8"))
    expect(config).toEqual({ plugins: [BUNDLED_PLUGIN_PACKAGE, "other"] })
    expect(config.plugin).toBeUndefined()
  })

  test("does not duplicate an entry that is already listed, in any of its shapes", async () => {
    for (const listed of [
      `["${BUNDLED_PLUGIN_PACKAGE}"]`,
      `["${BUNDLED_PLUGIN_PACKAGE}@1.4.0"]`,
      `[["${BUNDLED_PLUGIN_PACKAGE}", {}]]`,
      `[{ "package": "${BUNDLED_PLUGIN_PACKAGE}" }]`,
    ]) {
      const root = await tempRoot()
      const { source, cacheDir, configDir } = await setup(root)
      const original = `{ "plugin": ${listed} }`
      await writeFile(join(configDir, "hypercode.json"), original)

      await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log: collectLog() })

      expect(await readFile(join(configDir, "hypercode.json"), "utf8")).toBe(original)
    }
  })

  test("leaves an unparseable config untouched rather than rewriting it", async () => {
    const root = await tempRoot()
    const { source, cacheDir, configDir } = await setup(root)
    await writeFile(join(configDir, "hypercode.json"), "this is not json")
    const log = collectLog()

    const result = await seedBundledPlugin({ source, cacheDir, configDir, version: "1.2.3", log })

    expect(result.seeded.length).toBe(2)
    expect(result.configured).toBe(false)
    expect(await readFile(join(configDir, "hypercode.json"), "utf8")).toBe("this is not json")
    expect(log.warnings).toEqual(["skipped engine config edit"])
  })
})

describe("resolveBundledPluginSource", () => {
  test("prefers the packaged resources directory", async () => {
    const root = await tempRoot()
    await mkdir(join(root, "resourcesPath", "plugin"), { recursive: true })
    await mkdir(join(root, "appPath", "resources", "plugin"), { recursive: true })

    const resolved = resolveBundledPluginSource({
      resourcesPath: join(root, "resourcesPath"),
      appPath: join(root, "appPath"),
    })

    expect(resolved).toBe(join(root, "resourcesPath", "plugin"))
  })

  test("falls back to the repo copy so an unpackaged run behaves like a real install", async () => {
    const root = await tempRoot()
    await mkdir(join(root, "appPath", "resources", "plugin"), { recursive: true })

    const resolved = resolveBundledPluginSource({
      resourcesPath: join(root, "missing"),
      appPath: join(root, "appPath"),
    })

    expect(resolved).toBe(join(root, "appPath", "resources", "plugin"))
  })

  test("returns undefined when neither exists", async () => {
    const root = await tempRoot()
    expect(
      resolveBundledPluginSource({ resourcesPath: join(root, "a"), appPath: join(root, "b") }),
    ).toBeUndefined()
  })
})
