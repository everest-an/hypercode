import { createMemo, createSignal, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import type { useFile } from "@/context/file"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"
import { VAULT_CONFIG_PATH } from "./vault-config"

/**
 * Detects whether a directory has been scaffolded as a vault.
 *
 * The marker is `.opencode/vault.json`: the server resolves a missing file to
 * empty text content (no error toast), so "loaded but blank" means the folder
 * was opened as a vault but never initialized. Until this returned `true` there
 * is no template, no guard plugin and no git repo — which also means the
 * engine's file watcher never attaches and the tree/graph stay frozen.
 */
export function createVaultInitialized(file: ReturnType<typeof useFile>): () => boolean | undefined {
  void file.load(VAULT_CONFIG_PATH)
  return () => {
    const state = file.get(VAULT_CONFIG_PATH)
    if (!state?.loaded) return undefined
    const content = state.content
    if (!content || content.type !== "text") return false
    return content.content.trim().length > 0
  }
}

/**
 * Empty state shown in the vault content area when the folder is not a vault
 * yet. This is the only UI entry point to `platform.vaultInit` — without it the
 * scaffold IPC handler (`vault-init`) is unreachable from the renderer.
 */
export function VaultEmptyState(props: { vaultRoot: string; file: ReturnType<typeof useFile> }) {
  const platform = usePlatform()
  const [busy, setBusy] = createSignal(false)
  const supported = createMemo(() => typeof platform.vaultInit === "function")

  const initialize = async () => {
    if (!platform.vaultInit || busy()) return
    setBusy(true)
    try {
      const result = await platform.vaultInit(props.vaultRoot)
      if (!result.ok) {
        showToast({ variant: "error", title: "Could not initialize vault", description: result.error })
        return
      }
      // Re-read the marker and the root listing so the tree, preview and graph
      // pick up the scaffolded files without a manual reload.
      await Promise.all([props.file.load(VAULT_CONFIG_PATH, { force: true }), props.file.tree.refresh("")])
      showToast({
        variant: "success",
        title: "Vault ready",
        description:
          result.created.length > 0 ? `Created ${result.created.length} items` : "All template files already existed",
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not initialize vault",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="flex max-w-[420px] flex-col items-center gap-3 text-center">
        <span class="text-[28px] leading-none" aria-hidden>
          📓
        </span>
        <span class="text-13-medium text-text-strong">This folder isn't a vault yet</span>
        <p class="text-13-regular text-text-weak">
          Set up the starter layout: a protected progress board, an AI-writable notes folder, the write guard that keeps
          agents out of your files, and a git repo for live refresh. Existing files are never overwritten.
        </p>
        <Show
          when={supported()}
          fallback={<span class="text-[11px] text-text-weak">Open this vault in the desktop app to initialize it.</span>}
        >
          <ButtonV2 size="small" variant="outline" disabled={busy()} onClick={() => void initialize()}>
            {busy() ? "Initializing…" : "Initialize vault"}
          </ButtonV2>
        </Show>
      </div>
    </div>
  )
}
