import { describe, expect, test } from "bun:test"
import { isSelfCommand } from "@/mcp/self-exec"

// 这一层是**升级守门人**：本仓是 opencode 的 fork，引擎里那行判断属于 upstream 文件。
// 若某次合并 upstream 把它整文件覆盖回去，这个测试会立刻变红，而不是让本地办公连接器
// 在客户机（没有 Node）上静默失效。

describe("本地 MCP 自举：判断命令是否为本 CLI 自身", () => {
  test("接受两个产品名，含扩展名、目录、大小写", () => {
    for (const command of [
      "opencode",
      "opencode.exe",
      "hypercode",
      "hypercode.exe",
      "hypercode.cmd",
      "hypercode.bat",
      "HYPERCODE.EXE",
      "./hypercode",
      "/usr/local/bin/hypercode",
      "C:\\Program Files\\HyperCode\\hypercode.exe",
      "..\\bin\\hypercode.cmd",
    ]) {
      expect(isSelfCommand(command), `应识别为自身: ${command}`).toBe(true)
    }
  })

  test("拒绝其它可执行文件", () => {
    for (const command of [
      "npx",
      "node",
      "bun",
      "bunx",
      "npm",
      "pnpm",
      "yarn",
      "python",
      "hypercode-other",
      "not-hypercode.exe",
      "",
    ]) {
      expect(isSelfCommand(command), `不应识别为自身: ${command}`).toBe(false)
    }
  })

  test("两种路径分隔符在同一平台上行为一致", () => {
    // 用同一种分隔符风格构造的路径必须得到相同结果，因此 macOS / Linux / Windows 上断言一致。
    expect(isSelfCommand("/opt/hc/bin/hypercode")).toBe(true)
    expect(isSelfCommand("\\opt\\hc\\bin\\hypercode.exe")).toBe(true)
    expect(isSelfCommand("C:/tools/hypercode.exe")).toBe(true)
    expect(isSelfCommand("/opt/hc/bin/npx")).toBe(false)
    expect(isSelfCommand("C:\\tools\\npx.cmd")).toBe(false)
  })
})
