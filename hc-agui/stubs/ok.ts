// Stub engine #1: mimics `opencode run --format json` NDJSON output.
const j = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + "\n")
j({ type: "step_start", timestamp: Date.now(), sessionID: "ses_stub", part: { type: "step-start" } })
j({
  type: "tool_use",
  timestamp: Date.now(),
  sessionID: "ses_stub",
  part: { type: "tool", callID: "call_1", tool: "read", state: { status: "completed", input: { path: "a.ts" }, output: "file body" } },
})
j({ type: "text", timestamp: Date.now(), sessionID: "ses_stub", part: { type: "text", text: "hello from stub", time: { end: Date.now() } } })
