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

  // File contents are cached across rebuilds. The watcher fires on every agent write, and rebuilding from
  // scratch meant re-reading the whole vault — one file.read per note — just to learn that one file changed.
  // Building the graph itself is pure and in-memory, so that part still runs over the full set every time.
  const cache = new Map<string, string>()

  const rebuild = async (changed?: string) => {
    // The incremental path needs a warm cache and a single known file. Everything else — first paint, a
    // delete, a rename — falls through to the full scan, which is also what (re)populates the cache.
    if (changed && cache.size > 0) {
      const data = await sdk()
        .client.file.read({ path: changed })
        .then((x: any) => x.data)
        .catch(() => undefined)
      if (disposed) return
      if (data?.type === "text" && typeof data.content === "string") {
        cache.set(changed, data.content)
        render([...cache].map(([path, content]) => ({ path, content })))
        return
      }
      // Unreadable usually means deleted or renamed; a full scan is the cheapest way to stay correct.
    }

    setLoading(true)
    const paths = await listMarkdownFiles("")
    const files = await readAll(paths)
    if (disposed) return
    cache.clear()
    for (const entry of files) cache.set(entry.path, entry.content)
    render(files)
    setLoading(false)
  }

  const render = (files: { path: string; content: string }[]) => {
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
    // undefined = nothing pending; a string = exactly one file changed this tick; null = several did, so the
    // incremental path cannot be trusted and the next rebuild has to rescan.
    let pending: string | null | undefined
    const stop = sdk().event.listen((event) => {
      const details = event.details as { type: string; properties?: any }
      if (details.type !== "file.watcher.updated" && details.type !== "file.edited") return
      const changed = details.properties?.file
      if (typeof changed === "string" && !/\.md$/i.test(changed)) return
      clearTimeout(timer)
      // Pass the path through so a single write costs one read instead of a full vault scan. Coalescing
      // several changes into one tick means only the last path survives, so fall back to a full scan then.
      const only = typeof changed === "string" && pending === undefined ? changed : undefined
      pending = pending === undefined ? only : null
      timer = setTimeout(() => {
        const target = pending ?? undefined
        pending = undefined
        void rebuild(target)
      }, 800)
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
