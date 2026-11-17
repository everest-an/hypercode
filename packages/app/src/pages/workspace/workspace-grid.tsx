import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { useNavigate } from "@solidjs/router"
import { DateTime } from "luxon"
import { createMemo, createSignal, For, Show } from "solid-js"

const ORDER_KEY = "hypercode.workspace.grid.order"
const COLUMNS_KEY = "hypercode.workspace.grid.columns"

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
  const [order, setOrder] = createSignal<string[]>(readOrder())
  const [columns, setColumns] = createSignal<number>(readColumns())
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
                draggable={true}
                onDragStart={(event) => {
                  setDragging(card.id)
                  event.dataTransfer?.setData("text/plain", card.id)
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
                }}
                onDragEnd={() => setDragging(null)}
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
                onClick={() => openProject(card)}
                classList={{
                  "rounded-xl border border-border-weak-base bg-surface-base p-4 flex flex-col gap-3 cursor-pointer transition-transform": true,
                  "opacity-50": dragging() === card.id,
                  "hover:border-border-strong-base": true,
                }}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <div class="text-14-medium text-text-strong truncate">{card.name}</div>
                    <div class="text-11-regular text-text-weak truncate">{card.directory}</div>
                  </div>
                </div>
                <div class="flex items-center justify-between border-t border-border-weak-base pt-2">
                  <span class="text-11-regular text-text-weak">
                    {DateTime.fromMillis(card.updated).toRelative() ?? ""}
                  </span>
                  <span class="text-11-medium text-text-weak">{label("打开", "Open")}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
