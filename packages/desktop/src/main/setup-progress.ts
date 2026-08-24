import type { SetupStage, SetupState } from "@opencode-ai/app/setup-progress"

export type { SetupStage, SetupState }

/**
 * Broadcasts first-run preparation so the window can say what it is waiting for.
 *
 * Deliberately shaped like createUpdaterController: listeners get the current state immediately on
 * subscribe. The renderer connects well after the main process starts seeding, so without that replay it
 * would miss the only notification that matters and fall back to the connection-error screen — the exact
 * failure this exists to remove.
 *
 * Reporting is best-effort and never blocks or fails the seeding it describes: a broken listener must not
 * be able to stop the app from starting.
 */
export function createSetupProgress() {
  const listeners = new Set<(state: SetupState) => void>()
  let current: SetupState = { status: "idle" }

  const publish = (state: SetupState) => {
    current = state
    for (const listener of listeners) {
      try {
        listener(state)
      } catch {
        // A renderer that went away mid-send is not a reason to abandon the launch.
      }
    }
  }

  return {
    state: () => current,
    subscribe(listener: (state: SetupState) => void) {
      listeners.add(listener)
      listener(current)
      return () => listeners.delete(listener)
    },
    /** Call around a stage that is about to do visible work. No-op stages should not call this at all. */
    begin(stage: SetupStage, total?: number) {
      publish({ status: "preparing", stage, total, done: total === undefined ? undefined : 0 })
    },
    advance(stage: SetupStage, done: number, total?: number) {
      publish({ status: "preparing", stage, done, total })
    },
    /** Everything the launch was waiting on is on disk. */
    finish() {
      // Stay silent if nothing ever announced work: a normal launch should not flash a "done" screen.
      if (current.status === "idle") return
      publish({ status: "done" })
    },
  }
}

export type SetupProgress = ReturnType<typeof createSetupProgress>
