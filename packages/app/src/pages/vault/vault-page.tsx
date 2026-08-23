import { createMemo, createSignal, Show, type ParentProps } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useFile } from "@/context/file"
import { usePlatform } from "@/context/platform"
import { createVaultConfig } from "./vault-config"
import { createVaultInitialized, VaultEmptyState } from "./vault-init"
import { VaultGraph } from "./vault-graph"
import { VaultPreview } from "./vault-preview"
import { VaultTaskPanel } from "./vault-task-panel"
import { VaultTree } from "./vault-tree"

function basename(input: string) {
  const parts = input.replace(/\\/g, "/").replace(/\/+$/, "").split("/")
  return parts[parts.length - 1] || input
}

function truncateMiddle(input: string, max = 48) {
  if (input.length <= max) return input
  const half = Math.floor((max - 1) / 2)
  return `${input.slice(0, half)}…${input.slice(-half)}`
}

function joinPath(root: string, rel: string) {
  const separator = root.includes("\\") ? "\\" : "/"
  const trimmed = root.replace(/[/\\]+$/, "")
  return `${trimmed}${separator}${separator === "\\" ? rel.replace(/\//g, "\\") : rel}`
}

export function VaultPage(props: ParentProps<{ vaultRoot: string }>) {
  const file = useFile()
  const platform = usePlatform()
  const config = createVaultConfig(file)
  // `undefined` while the marker file is still loading — don't flash the empty
  // state at users who opened a perfectly good vault.
  const initialized = createVaultInitialized(file)
  const [selected, setSelected] = createSignal<string>()
  const [view, setView] = createSignal<"preview" | "graph">("preview")

  const selectNote = (path: string) => {
    setSelected(path)
    setView("preview")
  }

  const vaultName = createMemo(() => basename(props.vaultRoot))
  const selectedTitle = createMemo(() => {
    const path = selected()
    if (!path) return undefined
    return basename(path).replace(/\.md$/i, "")
  })
  const selectedAbsolute = createMemo(() => {
    const path = selected()
    if (!path) return undefined
    return joinPath(props.vaultRoot, path)
  })

  const openInEditor = () => {
    const absolute = selectedAbsolute()
    if (!absolute) return
    void platform.openPath?.(absolute)
  }

  return (
    <div class="flex size-full min-h-0 flex-col overflow-hidden bg-background-base">
      <div class="flex min-h-0 flex-1">
        <aside class="flex w-[260px] shrink-0 flex-col border-r border-border-weak-base">
          <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border-weak-base px-3">
            <span class="truncate text-13-medium text-text-strong">{vaultName()}</span>
          </div>
          <ScrollView class="min-h-0 flex-1">
            <VaultTree config={config} selected={selected} onSelect={selectNote} />
          </ScrollView>
        </aside>
        <main class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-weak-base px-4">
            <span class="truncate text-13-medium text-text-strong">
              {view() === "graph" ? "Graph view" : (selectedTitle() ?? "")}
            </span>
            <div class="flex items-center gap-1">
              <ButtonV2
                size="small"
                variant={view() === "preview" ? "outline" : "ghost"}
                onClick={() => setView("preview")}
              >
                Preview
              </ButtonV2>
              <ButtonV2 size="small" variant={view() === "graph" ? "outline" : "ghost"} onClick={() => setView("graph")}>
                Graph
              </ButtonV2>
              <Show when={view() === "preview" && selected() && platform.openPath}>
                <ButtonV2 size="small" variant="ghost" onClick={openInEditor}>
                  <Icon name="square-arrow-top-right" size="small" class="text-text-weak" />
                  Open in editor
                </ButtonV2>
              </Show>
            </div>
          </div>
          <Show
            when={view() === "graph"}
            fallback={
              <Show
                when={selected()}
                keyed
                fallback={
                  <Show
                    when={initialized() === false}
                    fallback={
                      <div class="flex flex-1 items-center justify-center text-13-regular text-text-weak">
                        Select a note
                      </div>
                    }
                  >
                    <VaultEmptyState vaultRoot={props.vaultRoot} file={file} />
                  </Show>
                }
              >
                {(path) => <VaultPreview path={path} onNavigate={selectNote} />}
              </Show>
            }
          >
            <VaultGraph vaultRoot={props.vaultRoot} config={config} selected={selected} onSelect={selectNote} />
          </Show>
        </main>
      </div>
      <VaultTaskPanel vaultRoot={props.vaultRoot} agent={config().defaultAgent} hook={config().hook} selected={selected} />
      <footer class="flex h-7 shrink-0 items-center gap-2 border-t border-border-weak-base px-3 text-[11px] text-text-weak">
        <span class="shrink-0">Hook: {config().hook}</span>
        <span aria-hidden>·</span>
        <span class="shrink-0">Agent: {config().defaultAgent}</span>
        <span aria-hidden>·</span>
        <span class="min-w-0 truncate" title={props.vaultRoot}>
          {truncateMiddle(props.vaultRoot)}
        </span>
        <div id="vault-status-extra" class="ml-auto flex items-center gap-2">
          {props.children}
        </div>
      </footer>
    </div>
  )
}
