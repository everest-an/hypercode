import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { useNavigate } from "@solidjs/router"
import { DateTime } from "luxon"
import { createMemo, createSignal, For, Show } from "solid-js"

const ORDER_KEY = "hypercode.workspace.grid.order"
const COLUMNS_KEY = "hypercode.workspace.grid.columns"
const LIVE_KEY = "hypercode.workspace.grid.live"

function readLive(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) === "1"
  } catch {
    return false
  }
}

/** Deep link for one project inside the current app shell (live pane). */
function paneUrl(directory: string) {
  const root = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "")
  return `${root}${base64Encode(directory)}/session`
}

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []
  } catch {
    return []
  }
}

function readColumns(): number {
  try {
    const value = Number(localStorage.getItem(COLUMNS_KEY))
    return value === 3 ? 3 : 2
  } catch {
    return 2
  }
}

function baseName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

/**
 * Workspace grid: one screen, several projects, drag to arrange.
 * Keeps each card a summary of the project; opening a card enters that
 * project's session, so the grid never fights the session router.
 */
export function WorkspaceGrid() {
  const sync = useServerSync()
  const navigate = useNavigate()
  const language = useLanguage()
  const platform = usePlatform()
  const [order, setOrder] = createSignal<string[]>(readOrder())
  const [columns, setColumns] = createSignal<number>(readColumns())
  const [live, setLive] = createSignal<boolean>(readLive())
  const [loaded, setLoaded] = createSignal<Record<string, boolean>>({})
  const [dragging, setDragging] = createSignal<string | null>(null)

  const zh = createMemo(() => language.locale().startsWith("zh"))
  const label = (zhText: string, enText: string) => (zh() ? zhText : enText)

  const projects = createMemo(() =>
    sync()
      .data.project.slice()
      .map((project) => ({
        id: project.id,
        directory: project.worktree,
        name: baseName(project.worktree),
        updated: project.time?.updated ?? project.time?.created ?? 0,
      }))
      .sort((a, b) => b.updated - a.updated),
  )

  const cards = createMemo(() => {
    const saved = order()
    const list = projects()
    if (!saved.length) return list
    const rank = new Map(saved.map((id, index) => [id, index]))
    return list.slice().sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return b.updated - a.updated
    })
  })

  function persistOrder(next: string[]) {
    setOrder(next)
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next))
    } catch {}
  }

  function persistColumns(next: number) {
    setColumns(next)
    try {
      localStorage.setItem(COLUMNS_KEY, String(next))
    } catch {}
  }

  function persistLive(next: boolean) {
    setLive(next)
    try {
      localStorage.setItem(LIVE_KEY, next ? "1" : "0")
    } catch {}
  }

  function move(source: string, target: string) {
    if (source === target) return
    const current = cards().map((card) => card.id)
    const from = current.indexOf(source)
    const to = current.indexOf(target)
    if (from < 0 || to < 0) return
    current.splice(from, 1)
    current.splice(to, 0, source)
    persistOrder(current)
  }

  function openProject(card: ReturnType<typeof cards>[number]) {
    navigate(`/${base64Encode(card.directory)}`)
  }

  return (
    <div class="mx-auto w-full max-w-6xl px-6 py-10 flex flex-col gap-6">
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-1">
          <div class="text-20-medium text-text-strong">{label("工作区网格", "Workspace grid")}</div>
          <div class="text-13-regular text-text-weak">
            {label("一屏看多个项目，拖动卡片排序", "See several projects at once. Drag cards to arrange.")}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <Button
            size="small"
            variant={live() ? "secondary" : "ghost"}
            onClick={() => persistLive(!live())}
          >
            {label("实时面板", "Live panes")}
          </Button>
          <Button
            size="small"
            variant={columns() === 2 ? "secondary" : "ghost"}
            onClick={() => persistColumns(2)}
          >
            {label("四宫格", "2 × 2")}
          </Button>
          <Button
            size="small"
            variant={columns() === 3 ? "secondary" : "ghost"}
            onClick={() => persistColumns(3)}
          >
            {label("九宫格", "3 × 3")}
          </Button>
        </div>
      </div>

      <Show
        when={cards().length > 0}
        fallback={
          <div class="rounded-xl border border-border-weak-base p-10 text-center text-13-regular text-text-weak">
            {label("还没有打开过的项目", "No projects opened yet")}
          </div>
        }
      >
        <div
          class="grid gap-4"
          style={{ "grid-template-columns": `repeat(${columns()}, minmax(0, 1fr))` }}
        >
          <For each={cards()}>
            {(card) => (
              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const source = event.dataTransfer?.getData("text/plain") || dragging()
                  if (source) move(source, card.id)
                  setDragging(null)
                }}
                classList={{
                  "rounded-xl border border-border-weak-base bg-surface-base overflow-hidden transition-transform": true,
                  "opacity-50": dragging() === card.id,
                  "hover:border-border-strong-base": true,
                }}
              >
                <div
                  draggable={true}
                  onDragStart={(event) => {
                    setDragging(card.id)
                    event.dataTransfer?.setData("text/plain", card.id)
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                  }}
                  onDragEnd={() => setDragging(null)}
                  onClick={() => openProject(card)}
                  class="flex items-center justify-between gap-2 px-3 py-2 cursor-grab border-b border-border-weak-base"
                >
                  <div class="flex flex-col min-w-0">
                    <span class="text-12-medium text-text-strong truncate">{card.name}</span>
                    <span class="text-10-regular text-text-weak truncate">{card.directory}</span>
                  </div>
                  <span class="flex items-center gap-2 shrink-0">
                    <Show when={typeof platform.runDesktopMenuAction === "function"}>
                      <span
                        role="button"
                        tabIndex={0}
                        class="text-11-medium text-text-weak hover:text-text-strong"
                        onClick={(event) => {
                          event.stopPropagation()
                          void platform.runDesktopMenuAction?.("window.new")
                        }}
                      >
                        {label("新窗口", "New window")}
                      </span>
                    </Show>
                    <span class="text-11-medium text-text-weak">{label("打开", "Open")}</span>
                  </span>
                </div>
                <Show
                  when={live()}
                  fallback={
                    <div class="p-4 flex items-center justify-between">
                      <span class="text-11-regular text-text-weak">
                        {DateTime.fromMillis(card.updated).toRelative() ?? ""}
                      </span>
                      <span class="text-11-regular text-text-weak">
                        {label("点击打开项目", "Click to open")}
                      </span>
                    </div>
                  }
                >
                  <Show
                    when={loaded()[card.id]}
                    fallback={
                      <div class="p-4 flex items-center justify-between gap-2">
                        <span class="text-11-regular text-text-weak">
                          {label("实时面板会新建/打开该项目会话", "Live pane opens a session for this project")}
                        </span>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => {
                            setLoaded((current) => ({ ...current, [card.id]: true }))
                          }}
                        >
                          {label("加载", "Load")}
                        </Button>
                      </div>
                    }
                  >
                    <div class="relative">
                      <span
                        role="button"
                        tabIndex={0}
                        class="absolute right-2 top-2 z-10 rounded bg-surface-base/90 border border-border-weak-base px-2 py-0.5 text-10-regular text-text-weak hover:text-text-strong"
                        onClick={(event) => {
                          event.stopPropagation()
                          setLoaded((current) => ({ ...current, [card.id]: false }))
                        }}
                      >
                        {label("卸载", "Unload")}
                      </span>
                      <iframe
                        src={paneUrl(card.directory)}
                        title={card.name}
                        class="w-full border-0 bg-surface-base"
                        style={{ height: columns() === 3 ? "280px" : "380px" }}
                      />
                    </div>
                  </Show>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
