import { Platform } from "react-native";

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

/** Thrown for a dead session so the app can fall back to sign-in instead of
 *  keeping a stale snapshot on screen that looks connected but fails on click. */
export class SessionExpiredError extends Error {}

export class MuseApi {
  constructor(
    readonly token: string,
    readonly onUnauthorized?: () => void,
  ) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
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
    return path.startsWith("http") ? path : `${API_URL}${path}`;
  }
}

export class SessionStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function createSession(
  accessKey?: string,
): Promise<{ token: string; mode: "sample" | "live" }> {
  const response = await fetch(`${API_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new SessionStatusError(
      payload.error || "Could not open your workspace.",
      response.status,
    );
  return payload;
}
