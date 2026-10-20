import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { npmPackageDir, sanitizeNpmSpec } from "./engine-paths"
import {
  installPlugin,
  readInstalledPluginVersion,
  recoverPluginTransaction,
  revertPlugin,
  type PluginManifest,
} from "./plugin-installer"
import { pluginStatePath, readPluginState, writePluginState } from "./plugin-state"

const roots: string[] = []
const payload = new TextEncoder().encode("payload")
const digest = createHash("sha256").update(payload).digest("hex")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function cache() {
  const root = await mkdtemp(join(tmpdir(), "hypercode-plugin-installer-"))
  roots.push(root)
  return root
}

async function seedTarget(root: string, spec: string, version: string) {
  const dir = join(npmPackageDir(root, spec), "node_modules", "oh-my-openagent")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version }))
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schema: 1,
    plugin: "oh-my-openagent",
    version: "5.1.34",
    compatibleApp: { min: "0.1.21", maxExclusive: "0.2.0" },
    assets: {
      "win32-x64": {
        file: "plugin-payload-win32-x64-5.1.34.zip",
        sha256: digest,
        url: "https://example.test/plugin.zip",
      },
    },
    ...overrides,
  }
}

const fetchStub = (async () => ({
  ok: true,
  arrayBuffer: async () => payload.buffer,
})) as unknown as typeof fetch

async function extract(_bytes: Uint8Array, dest: string) {
  const pkg = join(dest, "modules", "oh-my-openagent")
  await mkdir(join(pkg, "dist"), { recursive: true })
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "5.1.34" }))
  await writeFile(join(pkg, "dist", "index.js"), "export default 1")
}

describe("plugin installer", () => {
  test("installs both cache specs and records state", async () => {
    const root = await cache()
    await seedTarget(root, "oh-my-openagent", "4.19.4")
    await seedTarget(root, "oh-my-openagent@latest", "4.19.4")

    await installPlugin({
      cacheDir: root,
      manifest: manifest(),
      platform: "win32-x64",
      deps: { fetch: fetchStub, extract },
    })

    expect(await readInstalledPluginVersion(root)).toBe("5.1.34")
    const state = await readPluginState(root)
    expect(state?.activeVersion).toBe("5.1.34")
    expect(state?.previousVersion).toBe("4.19.4")
    expect(state?.pendingValidation).toBe(true)

    const backup = join(root, "packages", ".backup", "4.19.4", sanitizeNpmSpec("oh-my-openagent"))
    const backedUp = JSON.parse(await readFile(join(backup, "node_modules", "oh-my-openagent", "package.json"), "utf8"))
    expect(backedUp.version).toBe("4.19.4")
  })

  test("rejects a checksum mismatch", async () => {
    const root = await cache()
    await expect(
      installPlugin({
        cacheDir: root,
        manifest: manifest({
          assets: { "win32-x64": { file: "x.zip", sha256: "bad", url: "https://example.test/x.zip" } },
        }),
        platform: "win32-x64",
        deps: { fetch: fetchStub, extract },
      }),
    ).rejects.toThrow("checksum")
  })

  test("recovers a partially swapped transaction", async () => {
    const root = await cache()
    const spec = "oh-my-openagent"
    const other = "oh-my-openagent@latest"
    await seedTarget(root, spec, "5.1.34")
    const backup = join(root, "packages", ".backup", "4.19.4", sanitizeNpmSpec(spec))
    const backupPkg = join(backup, "node_modules", "oh-my-openagent")
    await mkdir(backupPkg, { recursive: true })
    await writeFile(join(backupPkg, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "4.19.4" }))

    const journal = {
      version: "5.1.34",
      previous: "4.19.4",
      specs: [spec, other],
      backups: { [spec]: backup },
      created: [other],
    }
    await mkdir(join(root, "packages"), { recursive: true })
    await writeFile(join(root, "packages", ".hypercode-plugin-txn.json"), JSON.stringify(journal))

    await recoverPluginTransaction(root)

    const restored = JSON.parse(
      await readFile(join(npmPackageDir(root, spec), "node_modules", "oh-my-openagent", "package.json"), "utf8"),
    )
    expect(restored.version).toBe("4.19.4")
  })

  test("reverts to a clean cache and clears state", async () => {
    const root = await cache()
    await seedTarget(root, "oh-my-openagent", "5.1.34")
    await writePluginState(root, {
      activeVersion: "5.1.34",
      source: "npm",
      specs: ["oh-my-openagent"],
      installedAt: "2026-10-19T00:00:00.000Z",
    })

    await revertPlugin(root)

    expect(await readInstalledPluginVersion(root)).toBeUndefined()
    expect(await readPluginState(root)).toBeUndefined()
    expect(await Bun.file(pluginStatePath(root)).exists()).toBe(false)
  })
})
