import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { EventSchema, RunAgentInputSchema } from "@ag-ui/core/schemas"

const DIR = import.meta.dirname ?? "."
const results: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

function startShim(env: Record<string, string>): Promise<ChildProcess> {
  return new Promise((res, rej) => {
    const p = spawn("bun", [`${DIR}/shim.ts`], {
      env: { ...process.env, PORT: env.PORT, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const timer = setTimeout(() => rej(new Error(`shim did not start: ${envLog}`)), 8000)
    let envLog = JSON.stringify(env)
    p.stderr.on("data", (c) => (envLog += `\n[shim stderr] ${c}`))
    p.stdout.on("data", (c) => {
      if (String(c).includes("hc-agui shim on")) {
        clearTimeout(timer)
        res(p)
      }
    })
  })
}

async function collect(port: number, body: unknown, token?: string, ms = 30000) {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    })
  } catch (e: any) {
    return { status: 0, json: null, events: [] as any[], aborted: `client aborted: ${e?.name}` }
  }
  if (!res.ok) return { status: res.status, json: await res.json().catch(() => null), events: [] as any[] }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ""
  const events: any[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue
        try {
          events.push(JSON.parse(line.slice(6)))
        } catch {
          events.push({ type: "__UNPARSEABLE__", raw: line })
        }
      }
    }
  }
  return { status: res.status, json: null, events }
}

const input = (over: Record<string, unknown> = {}) => ({
  threadId: "thr_1",
  runId: "run_1",
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
  messages: [{ id: "m1", role: "user", content: "say hi" }],
  ...over,
})

async function main() {
  // ---- 1. happy path against the NDJSON stub engine ----
  const okShim = await startShim({ PORT: "8791", HC_ENGINE_CMD: `bun ${DIR}/stubs/ok.ts`, HC_DIR: DIR })
  const ok = await collect(8791, input())
  const types = ok.events.map((e) => e.type)
  check(
    "1a 每个事件都能被 @ag-ui/core 的 EventSchema 接受",
    ok.events.every((e) => EventSchema.safeParse(e).success) && ok.events.length > 0,
    `${ok.events.length} 个事件，${ok.events.filter((e) => !EventSchema.safeParse(e).success).length} 个非法`,
  )
  check("1b 首事件 RUN_STARTED、末事件 RUN_FINISHED", types[0] === "RUN_STARTED" && types[types.length - 1] === "RUN_FINISHED", types.join(","))
  const text = ok.events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")
  check("1c 引擎正文完整透传", text === "hello from stub", JSON.stringify(text))
  check(
    "1d 工具调用三连 + 结果都在",
    ["TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT"].every((t) => types.includes(t)),
    types.filter((t) => t.startsWith("TOOL")).join(","),
  )
  okShim.kill(9)

  // ---- 2. 负控：无 token 必须 401，且不能有任何 RUN_STARTED ----
  const authShim = await startShim({ PORT: "8792", AGENT_TOKEN: "s3cret", HC_ENGINE_CMD: `bun ${DIR}/stubs/ok.ts`, HC_DIR: DIR })
  const noauth = await collect(8792, input())
  check("2a 缺 token → 401 且无事件流", noauth.status === 401 && noauth.events.length === 0, `status=${noauth.status}`)
  const withauth = await collect(8792, input(), "s3cret")
  check("2b 带 token → 正常跑完", withauth.events.some((e) => e.type === "RUN_FINISHED"), `${withauth.events.length} 个事件`)
  authShim.kill(9)

  // ---- 3. 负控：畸形 RunAgentInput 必须 400 ----
  const badShim = await startShim({ PORT: "8793", HC_ENGINE_CMD: `bun ${DIR}/stubs/ok.ts`, HC_DIR: DIR })
  const bad = await collect(8793, { threadId: "t", runId: "r" })
  check("3 缺 messages → 400", bad.status === 400 && bad.events.length === 0, `status=${bad.status} ${JSON.stringify(bad.json)}`)
  badShim.kill(9)

  // ---- 4. 负控：引擎非零退出必须 RUN_ERROR，不许假绿 ----
  const failShim = await startShim({ PORT: "8794", HC_ENGINE_CMD: `bun ${DIR}/stubs/fail.ts`, HC_DIR: DIR })
  const fail = await collect(8794, input())
  const failTypes = fail.events.map((e) => e.type)
  check(
    "4 引擎报错 → RUN_ERROR 且没有 RUN_FINISHED",
    failTypes.includes("RUN_ERROR") && !failTypes.includes("RUN_FINISHED"),
    failTypes.join(","),
  )
  const reported = String(fail.events.find((e) => e.type === "RUN_ERROR")?.message ?? "")
  check("4b 真实错误文案上来了（不是空壳）", reported.includes("AuthError"), JSON.stringify(reported.slice(0, 80)))
  failShim.kill(9)

  // ---- 5. 负控：静默退零（最阴的那种绿）必须 RUN_ERROR ----
  const emptyShim = await startShim({ PORT: "8795", HC_ENGINE_CMD: `bun ${DIR}/stubs/empty.ts`, HC_DIR: DIR })
  const empty = await collect(8795, input())
  const emptyTypes = empty.events.map((e) => e.type)
  check(
    "5 引擎没输出就退零 → RUN_ERROR，不是空流绿",
    emptyTypes.includes("RUN_ERROR") && !emptyTypes.includes("RUN_FINISHED"),
    emptyTypes.join(","),
  )
  emptyShim.kill(9)

  // ---- 6. 回归锚：引擎静默 13s（超过 Bun 默认 10s 空闲超时）仍要跑完 ----
  const slowShim = await startShim({ PORT: "8796", HC_ENGINE_CMD: `bun ${DIR}/stubs/slow.ts`, HC_DIR: DIR })
  const slow = await collect(8796, input({ threadId: "thr_slow", runId: "run_slow" }))
  const slowTypes = slow.events.map((e) => e.type)
  check(
    "6 长静默不被掐断 → RUN_FINISHED",
    slowTypes.includes("RUN_FINISHED") &&
      slow.events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("") === "still alive after 13s",
    slowTypes.join(","),
  )
  slowShim.kill(9)

  // ---- 7. 同一 threadId 的第二轮必须复用引擎会话（多轮记忆的锚） ----
  const sesShim = await startShim({ PORT: "8797", HC_ENGINE_CMD: `bun ${DIR}/stubs/ok.ts`, HC_DIR: DIR })
  await collect(8797, input({ threadId: "thr_ses", runId: "run_a" }))
  await collect(8797, input({ threadId: "thr_ses", runId: "run_b" }))
  const mapped = JSON.parse(readFileSync(`${DIR}/.sessions.json`, "utf8"))
  check("7 threadId → 引擎 sessionID 落盘且两轮同键", mapped.thr_ses === "ses_stub", JSON.stringify(mapped))
  sesShim.kill(9)

  // ---- 8. 负控：子进程 stdin 必须关闭（真引擎会等 EOF，开着就永久挂住） ----
  const inShim = await startShim({ PORT: "8798", HC_ENGINE_CMD: `bun ${DIR}/stubs/waitstdin.ts`, HC_DIR: DIR })
  const inside = await collect(8798, input({ threadId: "thr_stdin", runId: "run_stdin" }), undefined, 25000)
  const inTypes = inside.events.map((e) => e.type)
  check(
    "8 引擎等 stdin → 仍能跑完（没有挂死）",
    inTypes.includes("RUN_FINISHED") &&
      inside.events.some((e) => e.type === "TEXT_MESSAGE_CONTENT" && String(e.delta).includes("stdin closed")),
    inTypes.join(","),
  )
  inShim.kill(9)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error("verify crashed:", e)
  process.exit(2)
})
