import { afterEach, describe, expect, test } from "bun:test"
import {
  markSessionDeleted,
  resetDeletedSessions,
  shouldRecoverDeadTab,
  wasSessionDeletedThisRun,
} from "./deleted-sessions"

afterEach(resetDeletedSessions)

describe("deleted sessions", () => {
  // A tab restored from a previous run points at a session nobody in this window ever opened. It can never
  // load, so it is recovered silently instead of costing a click.
  test("a session nobody saw deleted is not marked", () => {
    expect(wasSessionDeletedThisRun("ses_from_a_previous_run")).toBe(false)
  })

  // The opposite case: the user was on it. Closing the tab under them would make the page vanish with no
  // explanation, so this is what keeps the message on screen.
  test("a session deleted while the window was open is marked", () => {
    markSessionDeleted("ses_open_when_deleted")

    expect(wasSessionDeletedThisRun("ses_open_when_deleted")).toBe(true)
    expect(wasSessionDeletedThisRun("ses_something_else")).toBe(false)
  })

  test("marking the same session twice is harmless", () => {
    markSessionDeleted("ses_a")
    markSessionDeleted("ses_a")

    expect(wasSessionDeletedThisRun("ses_a")).toBe(true)
  })
})

describe("shouldRecoverDeadTab", () => {
  test("recovers a tab whose session predates this window", () => {
    expect(shouldRecoverDeadTab("ses_from_a_previous_run")).toBe(true)
  })

  // The case the end-to-end test covers, restated here because that test needs a browser and a dev server
  // and cannot run everywhere. Without this, the condition deciding it would have nothing checking it.
  test("leaves the message up when the session was deleted under the user", () => {
    markSessionDeleted("ses_open_when_deleted")

    expect(shouldRecoverDeadTab("ses_open_when_deleted")).toBe(false)
  })

  test("does nothing without a session id", () => {
    expect(shouldRecoverDeadTab(undefined)).toBe(false)
  })
})
