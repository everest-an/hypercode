// Stub engine #5: blocks until stdin reaches EOF, like the real CLI does when it
// inherits an open pipe. Guards against the shim leaving the child's stdin alive.
let acc = ""
for await (const chunk of process.stdin) acc += chunk
process.stdout.write(
  JSON.stringify({
    type: "text",
    timestamp: Date.now(),
    sessionID: "ses_stdin",
    part: { type: "text", text: `stdin closed (${acc.length} bytes)`, time: { end: Date.now() } },
  }) + "\n",
)
