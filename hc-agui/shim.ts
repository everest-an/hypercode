import { spawn } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { EventType } from "@ag-ui/core"
import { RunAgentInputSchema, EventSchema } from "@ag-ui/core/schemas"

// @ag-ui/core's contentToText throws on plain-string content, which is what a text
// turn actually carries. Non-text parts (images/documents) are dropped for now.
function textOf(message: any): string {
  const content = message?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.filter((p: any) => p?.type === "text").map((p: any) => p.text ?? "").join("\n")
  return ""
}

const PORT = Number(process.env.PORT ?? 8791)
const TOKEN = process.env.AGENT_TOKEN ?? ""
const ENGINE = (process.env.HC_ENGINE_CMD ?? "").trim()
const HC_DIR = resolve(process.env.HC_DIR ?? process.cwd())
const AUTO = process.env.HC_AUTO === "1"
const SESSIONS_FILE = join(resolve(import.meta.dirname ?? "."), ".sessions.json")

function loadSessions(): Record<string, string> {
  try {
    return existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) : {}
  } catch {
    return {}
  }
}

function saveSession(threadId: string, sessionID: string) {
  const all = loadSessions()
  if (all[threadId] === sessionID) return
  all[threadId] = sessionID
  writeFileSync(SESSIONS_FILE, JSON.stringify(all, null, 2))
}

function engineArgv(prompt: string, session?: string) {
  if (!ENGINE) throw new Error("HC_ENGINE_CMD is not set")
  const argv = ENGINE.split(/\s+/)
  const cmd = argv.shift() as string
  const args = [...argv]
  if (session) args.push("--session", session)
  if (AUTO) args.push("--auto")
  // prompt stays a single argv element: it is never interpolated into a shell string
  args.push("--format", "json", prompt)
  return { cmd, args }
}

function encode(s: string) {
  return new TextEncoder().encode(s)
}

function emit(write: (e: Record<string, unknown>) => void, event: Record<string, unknown>) {
  const parsed = EventSchema.safeParse(event)
  if (parsed.success) {
    write(event)
    return
  }
  write({
    type: EventType.RUN_ERROR,
    message: `shim produced an invalid AG-UI event (${parsed.error.issues.map((i) => i.path.join(".")).join(", ")})`,
  })
}

async function handleRun(req: Request) {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 })
  if (TOKEN && req.headers.get("authorization") !== `Bearer ${TOKEN}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const raw = await req.json().catch(() => null)
  const parsed = RunAgentInputSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: "invalid RunAgentInput", issues: parsed.error.issues.map((i) => i.path.join(".")) },
      { status: 400 },
    )
  }

  const threadId = parsed.data.threadId
  const runId = parsed.data.runId
  const messages = parsed.data.messages ?? []
  const lastUser = [...messages].reverse().find((m: any) => m.role === "user")
  const prompt = textOf(lastUser)
  if (!prompt.trim()) return Response.json({ error: "no user message content" }, { status: 400 })

  // ReadableStream's start() only fires once the response body is pulled, which is
  // after runEngine begins emitting — so buffer until a controller exists.
  const out = bufferedStream()
  runEngine({ threadId, runId, prompt, send: out.send, close: out.close })

  return new Response(out.readable, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  })
}

function bufferedStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const queued: Uint8Array[] = []
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      while (queued.length) c.enqueue(queued.shift()!)
    },
  })
  return {
    readable,
    send(bytes: Uint8Array) {
      if (controller) {
        try {
          controller.enqueue(bytes)
        } catch {
          /* client already gone */
        }
      } else queued.push(bytes)
    },
    close() {
      if (controller) {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        controller = null
      }
    },
  }
}

function runEngine({ threadId, runId, prompt, send, close }: any) {
  const write = (event: Record<string, unknown>) => send(encode(`data: ${JSON.stringify(event)}\n\n`))
  let seq = 0
  let messageId = ""
  let textOpen = false
  let eventsFromEngine = 0
  let stderrText = ""
  let terminalError = ""
  let finished = false
  const seenTools = new Set<string>()
  // idleTimeout only buys 255s; a quiet engine must not be able to sever the run.
  const beat = setInterval(() => send(encode(": keepalive\n\n")), 20000)

  const term = (event: Record<string, unknown>) => {
    if (finished) return
    finished = true
    clearInterval(beat)
    emit(write, event)
    close()
  }

  const openText = () => {
    if (textOpen) return
    messageId = `msg_${runId}_${++seq}`
    textOpen = true
    emit(write, { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" })
  }
  const closeText = () => {
    if (!textOpen) return
    textOpen = false
    emit(write, { type: EventType.TEXT_MESSAGE_END, messageId })
  }

  emit(write, { type: EventType.RUN_STARTED, threadId, runId })

  let child
  try {
    const { cmd, args } = engineArgv(prompt, loadSessions()[threadId])
    child = spawn(cmd, args, { cwd: HC_DIR, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
  } catch (e: any) {
    closeText()
    term({ type: EventType.RUN_ERROR, message: `engine could not start: ${e?.message ?? e}` })
    return
  }

  child.on("error", (e: Error) => {
    closeText()
    term({ type: EventType.RUN_ERROR, message: `engine could not start: ${e.message}` })
  })

  let buf = ""
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString()
    let nl
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let ev: any
      try {
        ev = JSON.parse(line)
      } catch {
        stderrText = stderrText || `engine printed non-JSON: ${line.slice(0, 200)}`
        continue
      }
      if (ev.sessionID) saveSession(threadId, String(ev.sessionID))
      eventsFromEngine++

      const part = ev.part ?? {}
      if (ev.type === "text") {
        const body = String(part.text ?? "")
        if (!body.trim()) continue
        openText()
        emit(write, { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: body })
        closeText()
        continue
      }

      if (ev.type === "tool_use") {
        const toolCallId = String(part.callID ?? part.id ?? `tool_${eventsFromEngine}`)
        const state = part.state ?? {}
        if (!seenTools.has(toolCallId)) {
          seenTools.add(toolCallId)
          closeText()
          emit(write, { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: String(part.tool ?? "tool") })
          emit(write, { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(state.input ?? {}) })
          emit(write, { type: EventType.TOOL_CALL_END, toolCallId })
        }
        if (state.status === "completed" || state.status === "error") {
          emit(write, {
            type: EventType.TOOL_CALL_RESULT,
            messageId: `msg_tool_${toolCallId}`,
            toolCallId,
            content: String(state.output ?? state.error ?? ""),
          })
        }
        continue
      }

      if (ev.type === "error") {
        terminalError = String(ev.error?.data?.message ?? ev.error?.name ?? ev.error ?? "engine reported an error")
      }
    }
  })

  child.stderr.on("data", (c: Buffer) => {
    const s = c.toString().trim()
    if (s) stderrText = stderrText ? `${stderrText}\n${s}` : s
  })

  child.on("close", (code) => {
    closeText()
    if (terminalError) return term({ type: EventType.RUN_ERROR, message: terminalError })
    if (eventsFromEngine === 0 || code !== 0 || stderrText) {
      return term({
        type: EventType.RUN_ERROR,
        message: stderrText || `engine exited ${code} after ${eventsFromEngine} event(s) without an error message`,
      })
    }
    term({ type: EventType.RUN_FINISHED, threadId, runId })
  })
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  // Default 10s idle would sever any run whose engine is quiet for a moment.
  idleTimeout: 255,
  fetch: (req) =>
    handleRun(req).catch((e) =>
      Response.json({ error: `shim crashed: ${e?.message ?? String(e)}` }, { status: 500 }),
    ),
})

console.log(`hc-agui shim on http://127.0.0.1:${PORT}/run  engine="${ENGINE || "UNSET"}"  dir=${HC_DIR}  auto=${AUTO}`)
