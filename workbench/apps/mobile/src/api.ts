import { Platform } from "react-native";

/**
 * The address the app itself talks to before anyone picks a computer. The web build on the
 * computer opens its local workspace; a phone only uses a baked address when a deployment set one.
 */
export const defaultApiUrl = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

/**
 * What the connect screen prefills. A phone without a baked deployment starts empty rather than
 * suggesting its own localhost, which could never be the computer's address.
 */
export const suggestedApiUrl = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" ? "http://localhost:8787" : "")
).replace(/\/$/, "");

/** Thrown for a dead session so the app can fall back to sign-in instead of
 *  keeping a stale snapshot on screen that looks connected but fails on click. */
export class SessionExpiredError extends Error {}

/** Thrown when the phone cannot reach the computer at all, which is a network problem, not a wrong key. */
export class ServerUnreachableError extends Error {}

export class SessionStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Session {
  token: string;
  mode: "sample" | "live";
  owner: string;
}

export class MuseApi {
  constructor(
    readonly token: string,
    readonly baseUrl: string,
    readonly onUnauthorized?: () => void,
  ) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await send(this.baseUrl, path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
      const message =
        typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
      if (response.status === 401) {
        this.onUnauthorized?.();
        throw new SessionExpiredError(message);
      }
      throw new Error(message);
    }
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  }
}

/** Opens a workspace with its long-lived access key, the fallback for someone who has one. */
export async function createSession(baseUrl: string, accessKey?: string): Promise<Session> {
  return post<Session>(baseUrl, "/api/session", { accessKey });
}

/** Trades the one-time code from the computer's screen for a fresh session on this phone. */
export async function claimPairing(baseUrl: string, code: string): Promise<Session> {
  return post<Session>(baseUrl, "/api/pairing/claim", { code });
}

/** Ends this device's session on the computer, so disconnecting is not only local cleanup. */
export async function revokeSession(baseUrl: string, token: string) {
  await send(baseUrl, "/api/session/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await send(baseUrl, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new SessionStatusError(
      typeof payload.error === "string" ? payload.error : "Could not open your workspace.",
      response.status,
    );
  }
  return payload;
}

async function send(baseUrl: string, path: string, init: RequestInit) {
  try {
    return await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new ServerUnreachableError(
      `Cannot reach ${baseUrl}. Check that the computer is awake, on the same network, and running HyperCode.`,
    );
  }
}
