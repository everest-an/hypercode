import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearPluginState, pluginStatePath, readPluginState, writePluginState } from "./plugin-state"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function cache() {
  const root = await mkdtemp(join(tmpdir(), "hypercode-plugin-state-"))
  roots.push(root)
  return root
}

describe("plugin state", () => {
  test("round-trips a valid state", async () => {
    const root = await cache()
    const state = {
      activeVersion: "5.1.34",
      source: "npm" as const,
      previousVersion: "4.19.4",
      specs: ["oh-my-openagent@latest", "oh-my-openagent"],
      installedAt: "2026-10-19T00:00:00.000Z",
      pendingValidation: true,
    }
    await writePluginState(root, state)
    expect(await readPluginState(root)).toEqual(state)
  })

  test("ignores malformed state", async () => {
    const root = await cache()
    await writePluginState(root, {
      activeVersion: "5.1.34",
      source: "npm",
      specs: ["oh-my-openagent"],
      installedAt: "2026-10-19T00:00:00.000Z",
    })
    expect(await readPluginState(root)).toBeDefined()

    await Bun.write(pluginStatePath(root), "{not json")
    expect(await readPluginState(root)).toBeUndefined()
  })

  test("clears the state file", async () => {
    const root = await cache()
    await writePluginState(root, {
      activeVersion: "5.1.34",
      source: "npm",
      specs: ["oh-my-openagent"],
      installedAt: "2026-10-19T00:00:00.000Z",
    })
    await clearPluginState(root)
    expect(await readPluginState(root)).toBeUndefined()
  })
})
