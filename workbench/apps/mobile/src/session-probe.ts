/**
 * The app probes for a keyless session on mount, so a 401 there only answers "may I open
 * without a key?" — printing it would blame the person for a field they never typed.
 * Every other failure still has to surface: a dead server has no other reporter.
 */
export function probeFailureIsReportable(status: number | undefined, keySupplied: boolean) {
  return keySupplied || status !== 401;
}
