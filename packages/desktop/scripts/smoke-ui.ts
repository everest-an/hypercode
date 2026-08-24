#!/usr/bin/env bun
/**
 * Assert the app actually rendered a usable window.
 *
 * This exists because v0.1.8 shipped completely unusable and every signal we had said it was fine: the
 * build was green, 114 unit tests passed, the installer was the right size, and main.log printed
 * `server ready`. The renderer was getting 401 on every request and the window showed nothing but
 * "Could not reach Local Server". The only hint was one line in renderer.log.
 *
 * So this reads what the user would actually see, and refuses to look at logs.
 *
 *   1. start the app with --remote-debugging-port=9222
 *        packaged:   "%LOCALAPPDATA%\Programs\hypercode-desktop\HyperCode.exe" --remote-debugging-port=9222
 *        from source: bunx electron-vite preview   (already opens 9222)
 *   2. bun ./scripts/smoke-ui.ts
 *
 * Exit 0 only when the composer is on screen. Anything else prints what was rendered instead.
 */

const port = Number(process.argv[2] ?? process.env.SMOKE_CDP_PORT ?? 9222)
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000)

// The window is usable once the composer is up. Matching several strings keeps this from breaking on a
// copy tweak; only the whole set disappearing counts as a failure.
const READY = ["New session", "Ask anything", "for commands"]
// Verbatim from the v0.1.8 failure. The retry line matters on its own: the app re-renders it forever, so a
// screenshot taken at the wrong moment looks merely slow rather than broken.
const BROKEN = ["Could not reach Local Server", "Retrying automatically", "Failed to start"]

type Target = { type: string; title: string; url: string; webSocketDebuggerUrl?: string }

async function targets(): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(4000) })
  return response.ok ? ((await response.json()) as Target[]) : []
}

/** document.body.innerText over CDP. Returns undefined while the target is still coming up. */
function renderedText(socketUrl: string) {
  return new Promise<string | undefined>((resolve) => {
    const socket = new WebSocket(socketUrl)
    const finish = (value: string | undefined) => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {}
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), 10_000)
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression: "document.body.innerText", returnByValue: true },
        }),
      )
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      const value = message.result?.result?.value
      finish(typeof value === "string" ? value : undefined)
    }
    socket.onerror = () => finish(undefined)
  })
}

let last = ""
while (Date.now() < deadline) {
  const page = (await targets().catch(() => [])).find((t) => t.type === "page" && t.webSocketDebuggerUrl)
  if (page?.webSocketDebuggerUrl) {
    const text = await renderedText(page.webSocketDebuggerUrl)
    if (text !== undefined) {
      last = text
      const broken = BROKEN.find((marker) => text.includes(marker))
      // Report the error state immediately. Retrying past it would just wait out the timeout and then
      // report the same thing 90 seconds later.
      if (broken) {
        console.error(`FAIL: the window is showing "${broken}"\n\n--- rendered ---\n${text.slice(0, 2000)}`)
        process.exit(1)
      }
      if (READY.some((marker) => text.includes(marker))) {
        console.log(`OK: window is usable\n\n--- rendered ---\n${text.slice(0, 600)}`)
        process.exit(0)
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}

console.error(
  last
    ? `FAIL: window never became usable\n\n--- last rendered ---\n${last.slice(0, 2000)}`
    : `FAIL: no CDP page target on 127.0.0.1:${port}. Was the app started with --remote-debugging-port=${port}?`,
)
process.exit(1)
