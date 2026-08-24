/**
 * Sessions the server told us were deleted while this window has been open.
 *
 * Exists to tell two situations apart that produce the identical error, and want opposite handling:
 *
 *   the user is looking at a session when it is deleted
 *     -> they need to be told; closing the tab under them would make the page vanish with no explanation
 *
 *   a restored tab points at a session that was already gone before launch
 *     -> the tab can never load, and every one of them costs a click before a composer is reachable.
 *        Nothing was ever open here, so there is nothing to explain
 *
 * Membership answers exactly that: an id in this set was deleted with the app running, so someone may have
 * been on it. Anything else predates the window.
 *
 * Deliberately module state rather than a store field. It is read during an error fallback's setup, must
 * survive route changes, and carries no meaning across restarts — persisting it would in fact break the
 * distinction, since every id would then look "deleted this run" forever.
 */
const deletedThisRun = new Set<string>()

export function markSessionDeleted(sessionID: string) {
  deletedThisRun.add(sessionID)
}

/** True when the server reported this session deleted since the window opened. */
export function wasSessionDeletedThisRun(sessionID: string) {
  return deletedThisRun.has(sessionID)
}

/**
 * Whether a tab stuck on "session not found" should close itself instead of asking the user to.
 *
 * Named and exported so the decision is testable on its own. The end-to-end test that covers the opposite
 * case — a session deleted while its tab is on screen — needs a browser and a dev server, and could not be
 * run on the machine this was written on; a one-line condition buried in a fallback component would then
 * have had nothing checking it at all.
 *
 * Only ever called once the error is already a typed SessionNotFoundError for this exact session, i.e. the
 * server looked and it is gone.
 */
export function shouldRecoverDeadTab(sessionID: string | undefined) {
  if (!sessionID) return false
  // Deleted with the window open means someone may have been on it, and it says so instead.
  return !wasSessionDeletedThisRun(sessionID)
}

/** Tests only. */
export function resetDeletedSessions() {
  deletedThisRun.clear()
}
