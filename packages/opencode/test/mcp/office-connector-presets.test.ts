import { describe, expect, test } from "bun:test"
import { Exit, Schema } from "effect"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

// 办公连接器目录随产品分发（bake/skills/hc-tools/hc-office/references/connectors.md）。
// 里面的每个 json 块都是直接给用户粘贴进 hypercode.json 的预设，因此必须逐个用真实配置
// schema 校验：一个写错的字段，用户要重启一次才能发现。

const CATALOG = path.join(
  import.meta.dir,
  "../../../../bake/skills/hc-tools/hc-office/references/connectors.md",
)

const decodeServers = Schema.decodeUnknownExit(Schema.Record(Schema.String, ConfigMCPV1.Info))

type Preset = { type: string; url?: string; command?: string[] }
type Block = { raw: string; value: Record<string, Preset> }

async function loadBlocks(): Promise<Block[]> {
  const markdown = await readFile(CATALOG, "utf8")
  const fenced = Array.from(markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)).map((match) => match[1])
  expect(fenced.length).toBeGreaterThan(0)
  return fenced.map((raw) => ({ raw, value: JSON.parse(raw) as Record<string, Preset> }))
}

describe("办公连接器目录", () => {
  test("每个预设都能被真实的 MCP 配置 schema 解码", async () => {
    for (const block of await loadBlocks()) {
      const result = decodeServers(block.value)
      if (Exit.isFailure(result)) {
        throw new Error(`预设解码失败：\n${block.raw}\n${String(result.cause)}`)
      }
      expect(Object.keys(block.value).length).toBeGreaterThan(0)
    }
  })

  test("本地连接器用 hypercode 自举，不依赖客户机的 Node", async () => {
    // 产品只下发一个二进制，客户机上没有 npx/node/bun；本地服务器必须走 `hypercode x`，
    // 由引擎以 BUN_BE_BUN=1 启动，让二进制自己充当运行时。
    const forbidden = new Set(["npx", "node", "bun", "bunx", "npm", "pnpm", "yarn"])
    for (const block of await loadBlocks()) {
      for (const [name, preset] of Object.entries(block.value)) {
        if (preset.type !== "local") continue
        const command = preset.command
        expect(command, `${name} 缺少 command`).toBeDefined()
        const executable = path.basename(String(command![0]).toLowerCase()).replace(/\.(exe|cmd|bat)$/, "")
        expect(forbidden.has(executable), `${name} 不能依赖 ${executable}，请改用 hypercode x`).toBe(false)
        expect(
          ["hypercode", "opencode"].includes(executable),
          `${name} 的 command[0] 应为 hypercode，实际为 ${executable}`,
        ).toBe(true)
      }
    }
  })

  test("本地连接器不传 -y（bun x 不接受这个标志）", async () => {
    // bun x 的标志只有 --bun / -p|--package / --no-install / --verbose / --silent。
    // 照抄 npx 的 `-y` 会让服务器直接起不来。
    for (const block of await loadBlocks()) {
      for (const [name, preset] of Object.entries(block.value)) {
        if (preset.type !== "local") continue
        expect(preset.command, `${name} 缺少 command`).not.toContain("-y")
      }
    }
  })

  test("远程连接器都带 url 且不使用 command", async () => {
    for (const block of await loadBlocks()) {
      for (const [name, preset] of Object.entries(block.value)) {
        if (preset.type !== "remote") continue
        expect(typeof preset.url, `${name} 缺少 url`).toBe("string")
        expect(String(preset.url)).toMatch(/^https?:\/\//)
        expect(preset.command, `${name} 不应同时声明 command`).toBeUndefined()
      }
    }
  })

  test("目录里不出现已知不存在的 npm 包", async () => {
    // 这几个包名在 npm 上并不存在（易被凭印象写出来）。
    const markdown = await readFile(CATALOG, "utf8")
    for (const bogus of ["@linear/mcp", "@notionhq/mcp", "@slack/mcp-server", "@atlassian/mcp"]) {
      expect(markdown.includes(`"${bogus}"`), `目录不应把 ${bogus} 当作可安装的包`).toBe(false)
    }
  })
})
