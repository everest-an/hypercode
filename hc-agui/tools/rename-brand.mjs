#!/usr/bin/env node
// 可重演的品牌改名器：默认只干跑并打印清单，--apply 才落盘。
// 分层规则（写死在这里，不靠记忆）：
//   绝不改 LICENSE / CHANGELOG.md / docs/VERIFICATION.md —— MIT 署名义务 + 上游的历史验收记录。
//   绝不改含上游 URL 的行（github.com/CopilotKit、copilotkit.ai、unpkg.com）。
//   只按文本扩展名白名单动手，二进制与 lockfile 不碰。
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { extname, join, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = process.argv[2] ?? "."
const APPLY = process.argv.includes("--apply")

const NEVER = new Set(["LICENSE", "CHANGELOG.md", join("docs", "VERIFICATION.md")])
const EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".css",
  ".html",
  ".command",
  ".txt",
  ".example",
  ".py", // 上一版漏了它 ⇒ apps/computer/files.py 里的 .openmuse- 临时前缀躲过了改名
  ".sh",
  ".plist",
  ".xml",
  ".gradle",
  ".toml",
])
// 无扩展名的文本件也必须进：上一版漏了 Dockerfile，结果镜像里装 /opt/openmuse/files.py，
// 改名后的 TS 去 exec /opt/hypercode/files.py ⇒ Files 全 422（终端却正常，最难查的那种）
const NOEXT = new Set(["Dockerfile", ".gitignore", ".dockerignore", ".npmrc", ".editorconfig", "NOTICE"])
const URL_GUARDS = [/github\.com\/CopilotKit/i, /copilotkit\.ai/i, /unpkg\.com/i]
const MAP = [
  ["OpenMuse", "HyperCode"],
  ["OPENMUSE", "HYPERCODE"],
  ["openmuse", "hypercode"],
]

function files() {
  const out = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean)
  return out.filter(
    (f) =>
      !NEVER.has(f) &&
      (EXT.has(extname(f)) || NOEXT.has(basename(f)) || NOEXT.has(f.split("/").pop())) &&
      !f.startsWith("assets/"),
  )
}

const report = []
for (const rel of files()) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) continue
  const before = readFileSync(abs, "utf8")
  if (!/openmuse/i.test(before)) continue
  let hits = 0
  // 逐行重建：不用 text.replace(line,...)，重复行或行互为子串时会替错位置
  const after = before
    .split("\n")
    .map((line) => {
      if (!/openmuse/i.test(line)) return line
      if (URL_GUARDS.some((re) => re.test(line))) return line
      hits += (line.match(/openmuse/gi) ?? []).length
      return MAP.reduce((s, [a, b]) => s.replaceAll(a, b), line)
    })
    .join("\n")
  if (hits > 0) {
    report.push({ file: rel, hits })
    if (APPLY) writeFileSync(abs, after)
  }
}

const total = report.reduce((n, r) => n + r.hits, 0)
console.log(`${APPLY ? "已改写" : "干跑（未落盘）"}：${report.length} 个文件，${total} 处`)
for (const r of report.sort((a, b) => b.hits - a.hits)) console.log(`  ${String(r.hits).padStart(4)}  ${r.file}`)
if (APPLY) {
  const left = execFileSync("git", ["-C", ROOT, "grep", "-icE", "openmuse", "--", "*.ts", "*.tsx", "*.md", "*.json", "*.yaml"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  console.log(`\n残留（应只剩 NEVER 名单里的署名/历史记录）：\n${left || "(无)"}`)
}
// 清单写到工具自己旁边，绝不落进目标仓库（上次落进 openmuse 根，被它的 biome 判成格式错）
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), ".hypercode-rename.json"), JSON.stringify({ at: new Date().toISOString(), apply: APPLY, target: ROOT, files: report, total }, null, 2))
