import { batch, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { normalizeSessionInfo } from "@/utils/session"
import { showToast } from "@/utils/toast"

type LogLine = {
  id: string
  kind: "info" | "text" | "tool" | "error" | "blocked"
  label: string
}

type PanelStatus = "idle" | "starting" | "running"

function upsert(lines: LogLine[], line: LogLine): LogLine[] {
  const index = lines.findIndex((existing) => existing.id === line.id)
  if (index === -1) return [...lines, line]
  const next = lines.slice()
  next[index] = line
  return next
}

const DENIAL_PATTERN = /denied|permission|prometheus-md-only|not allowed|protected/i

function BlockedDialog(props: { hook: string; detail: string }) {
  return (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup title="Write blocked by permission hook" description="Protected files require manual edits" />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-2 text-13-regular text-text-base">
          <p>
            The <code>{props.hook}</code> hook intercepted this write. Protected progress files can only be edited
            manually.
          </p>
          <p class="rounded bg-background-weak-base px-2 py-1 font-mono text-[11px] text-text-weak">{props.detail}</p>
        </div>
      </DialogBody>
      <DialogFooter />
    </Dialog>
  )
}

export function VaultTaskPanel(props: {
  vaultRoot: string
  agent: string
  hook: string
  selected: Accessor<string | undefined>
}) {
  const sdk = useSDK()
  const dialog = useDialog()
  const navigate = useNavigate()

  const [expanded, setExpanded] = createSignal(false)
  const [input, setInput] = createSignal("")
  const [status, setStatus] = createSignal<PanelStatus>("idle")
  const [sessionID, setSessionID] = createSignal<string>()
  const [lines, setLines] = createSignal<LogLine[]>([])
  /** Agent the live session actually runs as — undefined once we fell back to the server default. */
  const [activeAgent, setActiveAgent] = createSignal<string | undefined>(props.agent)

  let blockedShownFor = ""

  const append = (line: LogLine) => setLines((existing) => upsert(existing, line))

  const showBlocked = (key: string, detail: string) => {
    if (blockedShownFor === key) return
    blockedShownFor = key
    append({ id: `blocked:${key}`, kind: "blocked", label: `🔒 ${props.hook} blocked a write — ${detail}` })
    void dialog.show(() => <BlockedDialog hook={props.hook} detail={detail} />)
  }

  const stop = sdk().event.listen((event) => {
    const details = event.details as { type: string; properties?: Record<string, any> }
    const session = sessionID()
    if (!session) return
    const properties = details.properties ?? {}

    if (details.type === "message.part.updated") {
      const part = properties.part
      if (!part || part.sessionID !== session) return
      if (part.type === "text" && typeof part.text === "string") {
        append({ id: `part:${part.id}`, kind: "text", label: part.text })
        return
      }
      if (part.type === "tool") {
        const state = part.state ?? {}
        const toolStatus = typeof state.status === "string" ? state.status : "pending"
        append({ id: `part:${part.id}`, kind: "tool", label: `⚙ ${part.tool ?? "tool"} · ${toolStatus}` })
        if (toolStatus === "error" && typeof state.error === "string") {
          if (DENIAL_PATTERN.test(state.error)) showBlocked(part.id, state.error)
          else append({ id: `err:${part.id}`, kind: "error", label: state.error })
        }
      }
      return
    }

    if (details.type === "permission.replied") {
      if (properties.sessionID !== session) return
      if (properties.reply === "reject") showBlocked(String(properties.requestID ?? "reply"), "permission rejected")
      return
    }

    if (details.type === "session.error") {
      if (properties.sessionID && properties.sessionID !== session) return
      append({ id: `session-error:${Date.now()}`, kind: "error", label: "Session error — see full session view" })
      setStatus("idle")
      return
    }

    if (details.type === "session.idle") {
      if (properties.sessionID !== session) return
      append({ id: `idle:${Date.now()}`, kind: "info", label: "✓ Task finished — file tree refreshes automatically" })
      setStatus("idle")
    }
  })
  onCleanup(stop)

  const run = async (text: string) => {
    const task = text.trim()
    if (!task || status() !== "idle") return
    batch(() => {
      setExpanded(true)
      setStatus("starting")
      setActiveAgent(props.agent)
      setLines([{ id: "start", kind: "info", label: `▶ ${props.agent}: ${task}` }])
    })
    blockedShownFor = ""
    try {
      // Fall back to the server's default agent when the configured one (e.g.
      // "prometheus" from oh-my-openagent) is unavailable in this install.
      // The fallback must also apply to the prompt call: sending
      // `agent: "prometheus"` to a session created without it makes the engine
      // throw "Agent not found", which is exactly the case every user who has
      // not installed oh-my-openagent hits.
      let agent: string | undefined = props.agent
      const session = await sdk()
        .api.session.create({ agent: props.agent, location: { directory: props.vaultRoot } })
        .catch(() => {
          agent = undefined
          return sdk().api.session.create({ location: { directory: props.vaultRoot } })
        })
        .then(normalizeSessionInfo)
      setActiveAgent(agent)
      setSessionID(session.id)
      setStatus("running")
      if (!agent) {
        append({
          id: "agent-fallback",
          kind: "info",
          label: `⚠ Agent "${props.agent}" is not installed — running with the default agent instead.`,
        })
      }
      await sdk().api.session.prompt({ sessionID: session.id, agent, text: task })
    } catch (error) {
      append({
        id: `submit-error:${Date.now()}`,
        kind: "error",
        label: error instanceof Error ? error.message : String(error),
      })
      setStatus("idle")
      showToast({ variant: "error", title: "Task failed to start", description: String(error) })
    }
  }

  const enhanceCurrent = () => {
    const note = props.selected()
    if (!note) {
      showToast({ variant: "error", title: "No note selected", description: "Open a note first" })
      return
    }
    void run(
      `Enhance the note "${note}" in this vault: expand it with concrete examples and add [[wiki links]] to related notes. Write the result with the obsidian_write_note tool (never Edit/Write).`,
    )
  }

  const openFullSession = () => {
    const id = sessionID()
    if (!id) return
    navigate(`/${base64Encode(props.vaultRoot)}/session/${id}`)
  }

  const statusLabel = createMemo(() => {
    if (status() === "idle") return "idle"
    if (status() === "starting") return "starting…"
    return "running"
  })

  return (
    <section class="flex shrink-0 flex-col border-t border-border-weak-base">
      <div class="flex h-9 shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          class="flex items-center gap-1 text-13-medium text-text-strong"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
          ⚡ {activeAgent() ?? "default agent"}
        </button>
        <span class="text-[11px] text-text-weak">{statusLabel()}</span>
        <input
          class="min-w-0 flex-1 rounded border border-border-weak-base bg-background-weak-base px-2 py-1 text-13-regular text-text-base outline-none placeholder:text-text-weak"
          placeholder={`Ask ${props.agent} to work on this vault…`}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void run(input())
              setInput("")
            }
          }}
        />
        <ButtonV2 size="small" variant="ghost" disabled={status() !== "idle"} onClick={enhanceCurrent}>
          Enhance current note
        </ButtonV2>
        <Show when={sessionID()}>
          <ButtonV2 size="small" variant="ghost" onClick={openFullSession}>
            Full session view
          </ButtonV2>
        </Show>
      </div>
      <Show when={expanded() && lines().length > 0}>
        <ScrollView class="max-h-48 border-t border-border-weak-base">
          <div class="flex flex-col gap-1 px-3 py-2 font-mono text-[11px]">
            <For each={lines()}>
              {(line) => (
                <div
                  classList={{
                    "text-text-weak": line.kind === "info" || line.kind === "tool",
                    "text-text-base whitespace-pre-wrap": line.kind === "text",
                    "text-danger-base": line.kind === "error",
                    "text-danger-base font-semibold": line.kind === "blocked",
                  }}
                >
                  {line.label}
                </div>
              )}
            </For>
          </div>
        </ScrollView>
      </Show>
    </section>
  )
}
