// Stub engine #4: silent for longer than Bun.serve's default 10s idle timeout.
await new Promise((r) => setTimeout(r, 13000))
process.stdout.write(
  JSON.stringify({
    type: "text",
    timestamp: Date.now(),
    sessionID: "ses_slow",
    part: { type: "text", text: "still alive after 13s", time: { end: Date.now() } },
  }) + "\n",
)
