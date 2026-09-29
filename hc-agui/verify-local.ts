// 全本机验收锚：不开任何云 key，把 浏览器等价请求 → OpenMuse 本地 runtime → shim → hypercode 引擎
// 这一整条链跑通并硬断言。任何一环没电就 rc=1 并点名是哪一环，绝不静默绿。
import { spawn } from "node:child_process"

const SHIM_PORT = Number(process.env.SHIM_PORT ?? 8791)
const API_PORT = Number(process.env.API_PORT ?? 8933)
const OM_DIR = process.env.OM_DIR ?? "/Users/aricredemption/Projects/openmuse"
const SHIM_DIR = process.env.SHIM_DIR ?? "/Users/aricredemption/Projects/hc-agui"
const ENGINE =
  process.env.HC_ENGINE_CMD ??
  "bun --conditions=browser /Users/aricredemption/Projects/hypercode/packages/opencode/src/index.ts run -m deepseek/deepseek-flash"
const MARKER = process.env.LOCAL_MARKER ?? "hypercode-e2e-marker-42"
const WORKSPACE = "/tmp/hc-ws"
// 每次一发用新 threadId：否则引擎沿用上一发的会话记忆，直接背答案，
// "必须出现真实工具调用"这条断言就会被合法地跳过
const THREAD = process.env.ANCHOR_THREAD ?? `anchor-${Date.now()}`

function die(step: string, detail = "") {
  console.log(`FAIL  ${step}${detail ? ` — ${detail}` : ""}`)
  stopAll()
  process.exit(1)
}

function stopAll() {
  for (const k of kids) {
    try {
      process.kill(-k.pid, 9)
    } catch {
      try {
        k.kill(9)
      } catch {}
    }
  }
}

async function waitHealth(url: string, ms = 40000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return await r.json()
    } catch {}
    await new Promise((r) => setTimeout(r, 800))
  }
  die("仪器没电：等不到健康检查", url)
}

function start(label: string, file: string, argv: string[], env: Record<string, string>, log: string) {
  const child = spawn(file, argv, { cwd: env.CWD ?? OM_DIR, env: { ...process.env, ...env }, detached: true })
  const fd = Bun.file(log)
  child.on("exit", async (code) => {
    if (code !== 0 && code !== null) {
      const tail = (await fd.text()).split("\n").slice(-6).join("\n")
      console.log(`[hypercode-local] ${label} 退出 code=${code}\n${tail}`)
    }
  })
  return child
}

const kids = [
  start("shim", "bun", ["shim.ts"], { CWD: SHIM_DIR, PORT: String(SHIM_PORT), HC_DIR: WORKSPACE, HC_AUTO: "1", HC_ENGINE_CMD: ENGINE }, "/tmp/anchor_shim.log"),
  start("api", "pnpm", ["exec", "tsx", "apps/server/src/index.ts"], {
    CWD: OM_DIR,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
    WORKSPACE_MODE: "sample",
    HYPERCODE_THREADS: "local",
    AGENT_BACKEND: "agui",
    AGENT_URL: `http://127.0.0.1:${SHIM_PORT}/run`,
    DATA_DIR: "/tmp/hypercode-anchor",
    CPK_INTELLIGENCE_API_KEY: "",
  }, "/tmp/anchor_api.log"),
]

try {
  const health = await waitHealth(`http://127.0.0.1:${API_PORT}/api/health`)
  console.log(`PASS  无云 key 起服：${JSON.stringify(health)}`)
  if (!health.agentConfigured) die("agentConfigured=false：AGENT_BACKEND/AGENT_URL 没接上")

  const sess = await fetch(`http://127.0.0.1:${API_PORT}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).then((r) => r.json())
  if (!sess.token) die("拿不到会话 token")
  const H = { authorization: `Bearer ${sess.token}`, "content-type": "application/json" }

  const mt = await fetch(`http://127.0.0.1:${API_PORT}/api/main-thread`, { headers: H })
  if (mt.status !== 200) die("本地模式仍去碰了云", `main-thread HTTP ${mt.status} ${await mt.text()}`)
  console.log("PASS  main-thread 200（这一格原来会 502）")

  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/copilotkit/agent/default/run`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      threadId: THREAD,
      runId: `anchor-run-${Date.now()}`,
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
      messages: [{ id: "m1", role: "user", content: `read ${WORKSPACE}/hello.txt and reply with its exact contents` }],
    }),
    signal: AbortSignal.timeout(180000),
  })
  if (!res.ok) die(`run 请求 HTTP ${res.status}`, (await res.text()).slice(0, 200))

  const dec = new TextDecoder()
  let buf = ""
  const events: any[] = []
  for await (const chunk of res.body!) {
    buf += dec.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf("\n\n")) >= 0) {
      for (const ln of buf.slice(0, i).split("\n")) {
        if (ln.startsWith("data: ")) {
          try {
            events.push(JSON.parse(ln.slice(6)))
          } catch {}
        }
      }
      buf = buf.slice(i + 2)
    }
  }
  const t = events.map((e) => e.type)
  const text = events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
  console.log(`链路事件：${t.join(",")}`)
  const bad: string[] = []
  if (t[0] !== "RUN_STARTED") bad.push("首事件不是 RUN_STARTED")
  if (t[t.length - 1] !== "RUN_FINISHED") bad.push("末事件不是 RUN_FINISHED（云/引擎没电时会变 RUN_ERROR）")
  if (!t.includes("TOOL_CALL_RESULT")) bad.push("没有真实工具结果")
  if (!text.includes(MARKER)) bad.push(`正文没含 marker，实得 ${JSON.stringify(text.slice(0, 80))}`)
  if (bad.length) die("全链断言", bad.join("；"))
  console.log(`PASS  全本机端到端：无云 key → 本地 runtime → shim → 引擎 → 真工具调用 → 正文正确`)
} finally {
  stopAll()
}
console.log("LOCAL GREEN")
process.exit(0)
