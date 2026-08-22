import { createMemo, For, onMount, Show } from "solid-js"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useFile } from "@/context/file"
import { classifyPath, type VaultConfig } from "./vault-config"

const PROTECTED_TOOLTIP = "Protected by hook — agents cannot modify via Edit/Write; edit manually"
const WRITABLE_TOOLTIP = "Agents may create/enhance notes here (via obsidian_write_note)"

type VaultTreeProps = {
  config: () => VaultConfig
  selected: () => string | undefined
  onSelect: (relPath: string) => void
}

function isMarkdown(name: string) {
  return name.toLowerCase().endsWith(".md")
}

function visibleNodes(nodes: FileNode[]) {
  return nodes
    .filter((node) => {
      if (node.ignored) return false
      if (node.name.startsWith(".")) return false
      if (node.type === "file" && !isMarkdown(node.name)) return false
      return true
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function Marker(props: { kind: "protected" | "writable" }) {
  return (
    <TooltipV2
      placement="right"
      class="flex shrink-0 items-center"
      value={props.kind === "protected" ? PROTECTED_TOOLTIP : WRITABLE_TOOLTIP}
    >
      <span class="text-[11px] leading-none" aria-hidden>
        {props.kind === "protected" ? "\u{1F512}" : "✨"}
      </span>
    </TooltipV2>
  )
}

function VaultTreeLevel(props: VaultTreeProps & { dir: string; depth: number }) {
  const file = useFile()
  const nodes = createMemo(() => visibleNodes(file.tree.children(props.dir)))

  return (
    <For each={nodes()}>
      {(node) => {
        const kind = createMemo(() => classifyPath(props.config(), node.path))
        const expanded = () => file.tree.state(node.path)?.expanded ?? false
        const selected = () => props.selected() === node.path
        const marker = createMemo(() => {
          if (kind() === "protected") return "protected" as const
          if (kind() === "writable" && node.type === "directory") return "writable" as const
          return undefined
        })
        return (
          <>
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] hover:bg-surface-base-hover"
              classList={{
                "bg-surface-base-active text-text-strong": selected(),
                "text-text-base": !selected(),
                "opacity-70": kind() === "protected",
              }}
              style={{ "padding-left": `${8 + props.depth * 14}px` }}
              onClick={() => {
                if (node.type === "directory") {
                  file.tree.toggle(node.path)
                  return
                }
                props.onSelect(node.path)
              }}
            >
              <Show
                when={node.type === "directory"}
                fallback={<span class="w-3 shrink-0" aria-hidden />}
              >
                <Icon
                  name="chevron-right"
                  size="small"
                  class="shrink-0 text-text-weak transition-transform"
                  classList={{ "rotate-90": expanded() }}
                />
              </Show>
              <span class="min-w-0 flex-1 truncate">
                {node.type === "file" ? node.name.replace(/\.md$/i, "") : node.name}
              </span>
              <Show when={marker()}>{(kind) => <Marker kind={kind()} />}</Show>
            </button>
            <Show when={node.type === "directory" && expanded()}>
              <VaultTreeLevel
                config={props.config}
                selected={props.selected}
                onSelect={props.onSelect}
                dir={node.path}
                depth={props.depth + 1}
              />
            </Show>
          </>
        )
      }}
    </For>
  )
}

export function VaultTree(props: VaultTreeProps) {
  const file = useFile()
  onMount(() => {
    void file.tree.list("")
  })
  return (
    <div class="flex flex-col gap-px px-1.5 py-2">
      <VaultTreeLevel config={props.config} selected={props.selected} onSelect={props.onSelect} dir="" depth={0} />
    </div>
  )
}
