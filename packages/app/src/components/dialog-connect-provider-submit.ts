import { formatServerError } from "@/utils/server-errors"

type Translator = (key: string, vars?: Record<string, string | number>) => string

export type SubmitApiKeyInput = {
  apiKey: string
  /** Sends the key to the server. Rejects when the server refuses it. */
  connect: (key: string) => Promise<unknown>
  /** Closes the dialog and refreshes state. Only runs once the key is accepted. */
  complete: () => Promise<unknown>
  t: Translator
  setError: (message: string | undefined) => void
}

/**
 * The API-key form's submit, extracted so its failure paths can be tested.
 *
 * It shipped without a catch around `connect`, so a rejected key escaped as an unhandled promise and the
 * dialog just sat there — no message, no spinner, nothing. Mistyping a key and pasting an expired one are
 * the two most ordinary things that happen on this form, which made the most common failure look exactly
 * like a broken button. The error slot itself was always rendered; nothing could ever fill it except the
 * empty-input check.
 *
 * Returns true when the key was accepted, so callers can tell "done" from "showed the user an error".
 */
export async function submitApiKey(input: SubmitApiKeyInput): Promise<boolean> {
  const key = input.apiKey?.trim()
  if (!key) {
    input.setError(input.t("provider.connect.apiKey.required"))
    return false
  }

  input.setError(undefined)
  try {
    await input.connect(input.apiKey)
  } catch (error) {
    input.setError(
      input.t("provider.connect.status.failed", { error: formatServerError(error, input.t) }),
    )
    return false
  }

  // Deliberately outside the catch above: failing to close and refresh is a different problem from a
  // rejected key, and labelling it "authorization failed" beside the key field would send the user to fix
  // something that is not wrong.
  await input.complete()
  return true
}
