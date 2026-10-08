import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// 第二层守门：证明**当前工具链**下 BUN_BE_BUN 契约仍然成立。
// 本地 MCP 连接器全靠它——二进制被当作 bun 运行时后，`hypercode x <包>` 才能在
// 没有安装 Node 的客户机上工作。Bun 若改掉这个行为，这里立刻变红。
//
// 编译一个 1 行脚本只要几百毫秒，且不需要网络，所以可以放进日常 CI。

const MARKER = "COMPILED_ENTRY_RAN"

function run(file: string, args: string[], env: Record<string, string> = {}) {
  // 显式 pipe：否则子进程的 stdout 可能被继承到测试进程，这里就读到空串。
  // cwd 必须指向临时目录：包目录下的 bunfig.toml 声明了 preload，
  // 在那里运行会让产物因 “preload not found” 直接退出。
  const proc = Bun.spawnSync([file, ...args], {
    cwd: path.dirname(file),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: proc.exitCode,
    stdout: new TextDecoder().decode(proc.stdout).trim(),
    stderr: new TextDecoder().decode(proc.stderr).trim(),
  }
}

describe("本地 MCP 自举：BUN_BE_BUN 契约", () => {
  test("设置 BUN_BE_BUN 后，编译产物充当 bun 运行时", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hc-self-exec-"))
    try {
      const entry = path.join(dir, "entry.ts")
      const binary = path.join(dir, process.platform === "win32" ? "probe.exe" : "probe")
      await writeFile(entry, `console.log(${JSON.stringify(MARKER)})\n`)

      const build = Bun.spawnSync(["bun", "build", "--compile", entry, "--outfile", binary])
      expect(build.exitCode, new TextDecoder().decode(build.stderr)).toBe(0)

      // 不带变量：执行的是脚本本身。
      const plain = run(binary, [])
      expect(plain.stdout, `code=${plain.code} stderr=${plain.stderr}`).toBe(MARKER)

      // 带上变量：同一个二进制变成 bun 运行时，--version 打印版本号而非脚本输出。
      const asRuntime = run(binary, ["--version"], { BUN_BE_BUN: "1" })
      expect(asRuntime.stdout, `code=${asRuntime.code} stderr=${asRuntime.stderr}`).toMatch(/^\d+\.\d+\.\d+/)
      expect(asRuntime.stdout).not.toContain(MARKER)

      // `x` 子命令必须能经由编译产物路由到 bunx —— 本地办公连接器就是靠这条路径拉起 npm 包的。
      const asBunx = run(binary, ["x", "--help"], { BUN_BE_BUN: "1" })
      expect(`${asBunx.stdout}\n${asBunx.stderr}`).toContain("bunx")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
