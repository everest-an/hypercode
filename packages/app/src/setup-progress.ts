/**
 * First-run preparation, as the window needs to describe it.
 *
 * A fresh install has to move a ~44 MB skill library and a ~215 MB plugin tree out of the app bundle before
 * the engine starts, which takes over a minute on a normal laptop. Until this existed the window showed
 * "Could not reach Local Server / Retrying automatically..." for that whole time — the same screen a genuine
 * connection failure produces, so the honest reading was "it is broken". Two separate users reported exactly
 * that, and one of them was right for a different reason, which is how the real bug stayed hidden.
 *
 * Only reported while work is actually happening. A normal launch does nothing here and never leaves "idle".
 */
export type SetupStage = "skills" | "plugin"

export type SetupState =
  | { status: "idle" }
  /** Work is underway. `done`/`total` are stage counts, absent when a stage cannot report granularity. */
  | { status: "preparing"; stage: SetupStage; done?: number; total?: number }
  | { status: "done" }

export type SetupProgressPlatform = {
  subscribe(listener: (state: SetupState) => void): () => void
}
