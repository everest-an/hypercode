import { createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js"
import ForceGraph from "force-graph"
import { useFile } from "@/context/file"
import { useSDK } from "@/context/sdk"
import { buildVaultGraph, type VaultGraphNode } from "./vault-graph-data"
import type { VaultConfig } from "./vault-config"
import { classifyPath } from "./vault-config"

// All state below is scoped to this component instance (one vault, one mount).
// Nothing is persisted globally, so switching vaults or sessions rebuilds from
// scratch and cannot leak between them.
export function VaultGraph(props: {
  vaultRoot: string
  config: Accessor<VaultConfig>
  selected: Accessor<string | undefined>
  onSelect: (path: string) => void
}) {
  const file = useFile()
  const sdk = useSDK()

  let container!: HTMLDivElement
  let graph: ForceGraph | undefined
  let disposed = false
  const [loading, setLoading] = createSignal(true)
  const [count, setCount] = createSignal(0)

  const listMarkdownFiles = async (dir: string, depth = 0): Promise<string[]> => {
    if (depth > 12) return []
    const nodes = await sdk()
      .client.file.list({ path: dir })
      .then((x: any) => x.data ?? [])
      .catch(() => [])
    const out: string[] = []
    for (const node of nodes as Array<{ name: string; path: string; type: string; ignored?: boolean }>) {
      if (node.ignored || node.name.startsWith(".")) continue
      if (node.type === "directory") out.push(...(await listMarkdownFiles(node.path, depth + 1)))
      else if (/\.md$/i.test(node.name)) out.push(node.path)
    }
    return out
  }

  const readAll = async (paths: string[]) => {
    const results: { path: string; content: string }[] = []
    const CONCURRENCY = 8
    for (let start = 0; start < paths.length; start += CONCURRENCY) {
      const batch = paths.slice(start, start + CONCURRENCY)
      const contents = await Promise.all(
        batch.map((path) =>
          sdk()
            .client.file.read({ path })
            .then((x: any) => x.data)
            .catch(() => undefined),
        ),
      )
      for (let index = 0; index < batch.length; index++) {
        const data = contents[index]
        if (data?.type === "text" && typeof data.content === "string")
          results.push({ path: batch[index], content: data.content })
      }
    }
    return results
  }

  const palette = () => {
    const styles = getComputedStyle(container)
    const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    return {
      normal: pick("--text-weak", "#9aa0a6"),
      writable: pick("--text-interactive-base", "#7c9cff"),
      protected: pick("--text-danger-base", "#e5534b"),
      ghost: "rgba(154,160,166,0.35)",
      link: "rgba(154,160,166,0.18)",
      label: pick("--text-strong", "#e8eaed"),
    }
  }

  const rebuild = async () => {
    setLoading(true)
    const paths = await listMarkdownFiles("")
    const files = await readAll(paths)
    if (disposed) return
    const data = buildVaultGraph(files, (path) => classifyPath(props.config(), path))
    setCount(data.nodes.filter((node) => !node.ghost).length)
    const colors = palette()
    graph
      ?.graphData(data as any)
      .nodeId("id")
      .nodeLabel((node: any) => (node as VaultGraphNode).name)
      .nodeVal((node: any) => 1 + Math.min((node as VaultGraphNode).degree, 12))
      .nodeColor((node: any) => {
        const typed = node as VaultGraphNode
        if (typed.id === props.selected()) return colors.label
        if (typed.ghost) return colors.ghost
        if (typed.kind === "protected") return colors.protected
        if (typed.kind === "writable") return colors.writable
        return colors.normal
      })
      .linkColor(() => colors.link)
      .onNodeClick((node: any) => {
        const typed = node as VaultGraphNode
        if (!typed.ghost) props.onSelect(typed.id)
      })
    setLoading(false)
  }

  onMount(() => {
    graph = new ForceGraph(container)
    graph.backgroundColor("rgba(0,0,0,0)")
    const resize = () => graph?.width(container.clientWidth).height(container.clientHeight)
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    void rebuild()

    // Debounced auto-rebuild on markdown changes (agent writes, CLI writes).
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = sdk().event.listen((event) => {
      const details = event.details as { type: string; properties?: any }
      if (details.type !== "file.watcher.updated" && details.type !== "file.edited") return
      const changed = details.properties?.file
      if (typeof changed === "string" && !/\.md$/i.test(changed)) return
      clearTimeout(timer)
      timer = setTimeout(() => void rebuild(), 800)
    })

    onCleanup(() => {
      disposed = true
      stop()
      clearTimeout(timer)
      observer.disconnect()
      graph?._destructor()
      graph = undefined
    })
  })

  return (
    <div class="relative size-full min-h-0">
      <div ref={container} class="size-full" />
      <Show when={loading()}>
        <div class="absolute inset-0 flex items-center justify-center text-13-regular text-text-weak">
          Building graph…
        </div>
      </Show>
      <div class="absolute bottom-2 right-3 text-[11px] text-text-weak">{count()} notes</div>
    </div>
  )
}
