import { createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { FileProvider } from "@/context/file"
import { SDKProvider } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { decodeDirectory } from "@/pages/directory-layout"
import { showToast } from "@/utils/toast"
import { VaultPage } from "./vault-page"

// Thin data wrapper for the vault route. Deliberately does NOT reuse
// DirectoryDataProvider: its effect auto-navigates to `/<slug>…` when the sync
// directory changes, which would kick the user out of `/vault/<slug>`.
function VaultDataProvider(props: ParentProps<{ directory: string }>) {
  const sync = useSync()
  return (
    <DataProvider data={sync().data} directory={props.directory}>
      {props.children}
    </DataProvider>
  )
}

export function VaultContent(props: { directory: string }) {
  return (
    <SDKProvider directory={props.directory}>
      <VaultDataProvider directory={props.directory}>
        <FileProvider>
          <VaultPage vaultRoot={props.directory} />
        </FileProvider>
      </VaultDataProvider>
    </SDKProvider>
  )
}

export default function VaultRoute() {
  const params = useParams<{ dir: string }>()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decodeDirectory(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir || resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({ variant: "error", title: "Invalid vault URL" })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(directory) => <VaultContent directory={directory} />}
    </Show>
  )
}
