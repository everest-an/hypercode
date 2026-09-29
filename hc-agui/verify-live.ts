// 正向绿验收：真 hypercode 引擎经 shim 跑两轮。缺凭证时必须 rc!=0 并说"仪器没电"，绝不 skip 成绿。
const PORT = Number(process.env.PORT ?? 8777)
const MODEL = process.env.HC_MODEL ?? "deepseek/deepseek-flash"
const ROOT = import.meta.dirname ?? "."
const DIR = "/tmp/hc-ws"

async function collect(body: unknown) {
  const res = await fetch(`http://127.0.0.1:${PORT}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  })
  if (!res.ok) return { status: res.status, events: [] as any[], text: "", err: await res.text() }
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
      for (const line of buf.slice(0, i).split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            events.push(JSON.parse(line.slice(6)))
          } catch {}
        }
      }
      buf = buf.slice(i + 2)
    }
  }
  return {
    status: res.status,
    events,
    text: events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join(""),
    err: "",
  }
}

function die(msg: string) {
  console.log(`FAIL  ${msg}`)
  // process.exit() 不会跑 finally，必须在这儿就把 shim 收掉，
  // 否则下一发脚本会去问这台残留进程（今天就是这么被骗过一次）。
  try {
    child.kill(9)
  } catch {}
  process.exit(1)
}

const log = [] as string[]
const child = Bun.spawn(["bun", `${ROOT}/shim.ts`], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HC_DIR: DIR,
    HC_AUTO: "1",
    HC_ENGINE_CMD: `bun --conditions=browser /Users/aricredemption/Projects/hypercode/packages/opencode/src/index.ts run -m ${MODEL}`,
  },
  stdout: "pipe",
  stderr: "ignore",
})
{
  // 必须确认"我起的那台"绑上了端口：上一发的残留 shim 会让本脚本去问错的进程。
  const read = new Response(child.stdout).body!.getReader()
  const dec = new TextDecoder()
  const deadline = Date.now() + 15000
  let banner = ""
  while (Date.now() < deadline) {
    const { done, value } = await read.read()
    if (done) break
    const chunk = dec.decode(value, { stream: true })
    log.push(chunk)
    banner += chunk
    if (banner.includes("hc-agui shim on")) break
  }
  if (!banner.includes("hc-agui shim on")) {
    console.log(`FAIL  仪器自己没电：shim 没能起来（端口被占？）\n${banner}`)
    child.kill(9)
    process.exit(1)
  }
}

try {
  const r1 = await collect({
    threadId: "thr_live",
    runId: "run_live_1",
    messages: [{ id: "m1", role: "user", content: `read /tmp/hc-ws/hello.txt and reply with its exact contents` }],
  })
  const t1 = r1.events.map((e) => e.type)
  console.log(`第 1 轮事件：${t1.join(",")}`)
  if (r1.status !== 200) die(`HTTP ${r1.status} — shim 未就绪：${r1.err.slice(0, 200)}`)

  const authErr = r1.events.find((e) => e.type === "RUN_ERROR")
  if (authErr) {
    die(`仪器没电（不是判负）：引擎回 RUN_ERROR = ${JSON.stringify(String(authErr.message).slice(0, 160))}
        → 需要可用的模型凭证：跑 \`hypercode auth\` 重新登录，或用一把新 key 写 ~/.config/hypercode/hypercode.json（支持 {env:VAR} 插值，见 packages/opencode/src/config/variable.ts:33）`)
  }
  if (!t1.includes("RUN_FINISHED")) die(`没有 RUN_FINISHED，收到 ${t1.join(",")}`)
  if (r1.text.trim().length === 0) die("RUN_FINISHED 但正文为空 = 假绿")
  if (!t1.includes("TOOL_CALL_RESULT"))
    console.log("WARN  本轮没有真实工具调用（模型可能直接背答案）；工具链证据不足")
  else console.log("PASS  正向绿：正文 + 工具结果 + RUN_FINISHED")

  const r2 = await collect({
    threadId: "thr_live",
    runId: "run_live_2",
    messages: [
      { id: "m1", role: "user", content: "read /tmp/hc-ws/hello.txt and reply with its exact contents" },
      { id: "m2", role: "assistant", content: r1.text },
      { id: "m3", role: "user", content: "what file did you just read? reply with only its filename" },
    ],
  })
  const t2 = r2.events.map((e) => e.type)
  console.log(`第 2 轮事件：${t2.join(",")}`)
  if (!t2.includes("RUN_FINISHED")) die(`第 2 轮没有 RUN_FINISHED：${t2.join(",")}`)
  if (!r2.text.toLowerCase().includes("hello"))
    die(`第 2 轮没接住上下文（多轮复用失败）：${JSON.stringify(r2.text.slice(0, 120))}`)
  console.log("PASS  多轮：同一 threadId 接住了上一轮的文件名")
} finally {
  child.kill(9)
}
console.log("LIVE GREEN")
