export const GOOGLE_HANDBACK_TYPE = "hypercode:google-connected";

/**
 * The callback window is one we opened, not a channel anyone may speak into: accept our own
 * signal only, and only from our own origin.
 */
export function isGoogleHandback(event: { origin: string; data: unknown }, appOrigin: string) {
  return (
    event.origin === appOrigin &&
    (event.data as { type?: string } | null)?.type === GOOGLE_HANDBACK_TYPE
  );
}

/**
 * Resolves true when the callback window hands the result back, false when the person closed it
 * without finishing. Without this the workspace would keep showing the pre-connect state until
 * the person happened to press refresh.
 */
export function waitForGoogleHandback(popup: Window): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let watch: ReturnType<typeof setInterval> | undefined;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      if (watch) clearInterval(watch);
      resolve(connected);
    };
    function onMessage(event: MessageEvent) {
      if (isGoogleHandback(event, window.location.origin)) finish(true);
    }
    window.addEventListener("message", onMessage);
    watch = setInterval(() => {
      if (popup.closed) finish(false);
    }, 500);
  });
}
