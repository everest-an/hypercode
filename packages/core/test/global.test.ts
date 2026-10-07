import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    // The app name is a fork-level rename target, so read it from another Global path
    // instead of hardcoding "opencode" again — hardcoding is exactly why this broke
    // when the fork renamed the app.
    const app = path.basename(Global.Path.config)
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), app))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})
