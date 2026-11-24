/** One computer a phone can connect to, as carried by the code on screen. */
export interface PairingTarget {
  /** The address to try first. */
  url: string;
  /** The short code shown under the QR code. */
  code: string;
  /** Other addresses for the same computer, tried when the first one fails. */
  alternates: string[];
}

const LINK = /^hypercode:\/\/pair\?(.+)$/i;

/**
 * Reads the `hypercode://pair` link a phone's Camera app opens after scanning the QR code.
 * Returns nothing for unrelated links so a normal deep link is never treated as pairing.
 */
export function parsePairingLink(input: string): PairingTarget | undefined {
  const match = LINK.exec(input.trim());
  if (!match) return undefined;
  const params = new URLSearchParams(match[1]);
  const url = normalizeServerUrl(params.get("u") ?? "");
  const code = normalizeCode(params.get("c") ?? "");
  if (!url || !code) return undefined;
  const alternates = (params.get("a") ?? "")
    .split(",")
    .map((value) => normalizeServerUrl(value))
    .filter((value): value is string => value !== undefined && value !== url);
  return { url, code, alternates: [...new Set(alternates)] };
}

/** Builds the QR payload the phone scans. Kept in one place so both sides cannot drift. */
export function pairingLink(url: string, code: string, alternates: string[] = []) {
  const params = new URLSearchParams({ v: "1", u: url, c: code });
  const other = [...new Set(alternates)].filter((value) => value !== url);
  if (other.length) params.set("a", other.join(","));
  return `hypercode://pair?${params.toString()}`;
}

/**
 * Accepts what a person types into the address field: a bare host, a host with a port, or a
 * full origin. Paths and credentials are dropped because every API route starts at the origin.
 */
export function normalizeServerUrl(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  return attempt(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
}

function attempt(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (!url.hostname) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Mirrors the server: uppercase, and only characters the generated alphabet contains. */
export function normalizeCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

/** The part of an address worth showing to a person. */
export function hostOf(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
