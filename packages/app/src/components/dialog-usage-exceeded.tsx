import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { JSX, Show } from "solid-js"

export type DialogGoUpsellProps = {
  title: string
  description: JSX.Element
  link?: string
  actionLabel: string
  /** Shown as a secondary button when provided: guide the user to bring their own key. */
  configureKeyLabel?: string
  onClose?: (dontShowAgain?: boolean) => void
}

export function DialogUsageExceeded(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()

  const runAction = () => {
    if (props.link) platform.openExternal(props.link)
    dialog.close()
  }

  const configureKey = () => {
    props.onClose?.()
    dialog.close()
  }

  const dismiss = () => {
    props.onClose?.(true)
    dialog.close()
  }

  return (
    <Dialog title={props.title} description={props.description} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={dismiss}>
            {language.t("dialog.usageExceeded.dontShowAgain")}
          </Button>
          <Show when={props.configureKeyLabel}>
            <Button variant="secondary" size="large" onClick={configureKey}>
              {props.configureKeyLabel}
            </Button>
          </Show>
          <Button variant="primary" size="large" onClick={runAction}>
            {props.actionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
