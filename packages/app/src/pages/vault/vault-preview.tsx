import { createEffect, createMemo, Show } from "solid-js"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useFile } from "@/context/file"
import { showToast } from "@/utils/toast"

const WIKILINK_SCHEME = "wikilink:"
const WIKILINK_PATTERN = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g

/**
 * Rewrites `[[Target]]` / `[[Target|Alias]]` into `[Alias](#wikilink:Target)`
 * markdown links, skipping lines inside fenced code blocks.
 *
 * The `#` prefix matters: the markdown renderer sanitizes HTML through
 * DOMPurify, whose default URI allowlist strips custom protocols like a bare
 * `wikilink:` href, while fragment hrefs pass through untouched. Click handling
 * matches on the `wikilink:` substring, so it works either way.
 */
export function transformWikiLinks(text: string): string {
  const lines = text.split("\n")
  let fence: string | undefined
  return lines
    .map((line) => {
      const open = line.match(/^\s*(```|~~~)/)
      if (open) {
        if (!fence) fence = open[1]
        else if (open[1] === fence) fence = undefined
        return line
      }
      if (fence) return line
      return line.replace(
        WIKILINK_PATTERN,
        (_, target: string, alias: string | undefined) =>
          `[${(alias ?? target).trim()}](#${WIKILINK_SCHEME}${encodeURIComponent(target.trim())})`,
      )
    })
    .join("\n")
}

function basename(input: string) {
  const parts = input.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] ?? input
}

export function VaultPreview(props: { path: string; onNavigate: (relPath: string) => void }) {
  const file = useFile()

  createEffect(() => {
    void file.load(props.path)
  })

  const state = createMemo(() => file.get(props.path))
  const processed = createMemo(() => {
    const content = state()?.content
    if (!content || content.type !== "text") return undefined
    return transformWikiLinks(content.content)
  })

  const resolveWikiLink = async (name: string) => {
    const results = await file.searchFiles(name, { limit: 20 })
    const markdown = results.filter((entry) => entry.toLowerCase().endsWith(".md"))
    const wanted = `${name.toLowerCase()}.md`
    const exact = markdown.find((entry) => basename(entry).toLowerCase() === wanted)
    const target = exact ?? markdown[0]
    if (!target) {
      showToast({ variant: "error", title: `Note not found: ${name}` })
      return
    }
    props.onNavigate(target)
  }

  const onClickCapture = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest?.("a")
    if (!anchor) return
    const href = anchor.getAttribute("href") ?? ""
    const index = href.indexOf(WIKILINK_SCHEME)
    if (index === -1) return
    event.preventDefault()
    event.stopPropagation()
    let name = href.slice(index + WIKILINK_SCHEME.length)
    try {
      name = decodeURIComponent(name)
    } catch {
      // keep raw value
    }
    void resolveWikiLink(name)
  }

  return (
    <ScrollView class="min-h-0 flex-1">
      <div class="mx-auto w-full max-w-3xl px-6 py-6" on:click={onClickCapture}>
        <Show
          when={processed() !== undefined}
          fallback={
            <Show
              when={state()?.loaded && state()?.content?.type === "binary"}
              fallback={<div class="text-13-regular text-text-weak">Loading…</div>}
            >
              <div class="text-13-regular text-text-weak">Cannot preview binary file</div>
            </Show>
          }
        >
          <Markdown text={processed()!} class="select-text" />
        </Show>
      </div>
    </ScrollView>
  )
}
