#!/usr/bin/env bun
// 办公连接器活性探针（开发/运维工具，不随产品分发）
//
//   bun bake/verify/connectors-liveness.mjs
//
// 直接解析 references/connectors.md，因此往目录里新增连接器后无需改本脚本。
//
// 为什么需要它：连接器会“上锈”。Atlassian 的 /v1/sse 就是在 2026-06-30 被停掉的——
// 出货的产品若还指着旧 URL，客户第一次接入就会失败，而我们这边没有任何信号。
//
// 判据不是“返回 200”，而是“端点在、且说话”：
//   401 / 403 / 405 / 406 / 400 → 端点存在（只是需要鉴权或换了方法）
//   404                        → URL 搬家了，必须改
//   2xx                        → 端点存在
//   其它 5xx                   → 端点降级，需要人看一眼

import { readFile } from "node:fs/promises"
import path from "node:path"

const CATALOG = path.resolve(import.meta.dir, "../skills/hc-tools/hc-office/references/connectors.md")
const TIMEOUT_MS = 20_000

const ALIVE_STATUS = new Set([200, 201, 204, 400, 401, 403, 405, 406])

function serversFrom(markdown) {
  const blocks = [...markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((match) => match[1])
  const servers = new Map()
  for (const raw of blocks) {
    for (const [name, preset] of Object.entries(JSON.parse(raw))) servers.set(name, preset)
  }
  return servers
}

// `["hypercode","x","@scope/pkg@1.2.3", ...]` → 包名与固定版本
function localPackage(command = []) {
  const spec = command[2] ?? ""
  const at = spec.indexOf("@", 1) // scoped 包的 @ 在首位，所以从 1 之后找
  return at === -1 ? { name: spec } : { name: spec.slice(0, at), pinned: spec.slice(at + 1) }
}

/** 指向用户本机的端点（如 Obsidian 插件）只有用户开着对应软件时才可达，不参与判定。 */
function isLocalEndpoint(url) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

async function probeRemote(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json, text/event-stream" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (ALIVE_STATUS.has(response.status)) return { state: "alive", detail: `HTTP ${response.status}` }
    if (response.status === 404) return { state: "moved", detail: "HTTP 404（URL 已搬家）" }
    return { state: "degraded", detail: `HTTP ${response.status}` }
  } catch (error) {
    return { state: "unreachable", detail: error?.message ?? String(error) }
  }
}

async function probeLocal(name, pinned) {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return { state: "missing", detail: `registry HTTP ${response.status}` }
    const info = await response.json()
    const latest = info?.["dist-tags"]?.latest ?? "?"
    const detail = pinned ? `${pinned} → latest ${latest}` : `latest ${latest}`
    return { state: pinned && latest !== pinned ? "behind" : "alive", detail }
  } catch (error) {
    return { state: "unreachable", detail: error?.message ?? String(error) }
  }
}

const markdown = await readFile(CATALOG, "utf8")
const servers = serversFrom(markdown)
const results = []

for (const [name, preset] of servers) {
  if (preset.type === "remote") {
    if (isLocalEndpoint(preset.url)) {
      results.push({
        name,
        kind: "remote",
        target: preset.url,
        state: "local",
        detail: "本地端点：需用户本机运行对应软件，不参与判定",
      })
      continue
    }
    results.push({ name, kind: "remote", target: preset.url, ...(await probeRemote(preset.url)) })
    continue
  }
  const { name: pkg, pinned } = localPackage(preset.command)
  results.push({ name, kind: "local", target: pkg, ...(await probeLocal(pkg, pinned)) })
}

const label = {
  alive: "正常",
  behind: "有新版本",
  degraded: "降级",
  moved: "端点搬家",
  missing: "包不存在",
  unreachable: "不可达",
  local: "本地跳过",
}

console.log(`办公连接器活性报告（${servers.size} 个，来源：${path.relative(process.cwd(), CATALOG)}）\n`)
for (const r of results) {
  console.log(`  ${label[r.state].padEnd(6)} ${r.name.padEnd(18)} ${r.kind.padEnd(6)} ${r.target}`)
  console.log(`         ${r.detail}`)
}

const broken = results.filter((r) => ["moved", "missing", "unreachable", "degraded"].includes(r.state))
const behind = results.filter((r) => r.state === "behind")

console.log(
  `\n正常 ${results.filter((r) => r.state === "alive").length} · ` +
    `有新版本 ${behind.length} · 本地跳过 ${results.filter((r) => r.state === "local").length} · ` +
    `需处理 ${broken.length}`,
)
if (behind.length) console.log(`有新版本（升级是显式动作，改完同步版本快照表）：${behind.map((r) => r.name).join(", ")}`)
if (broken.length) console.log(`需处理：${broken.map((r) => `${r.name}(${label[r.state]})`).join(", ")}`)

process.exit(broken.length ? 1 : 0)
