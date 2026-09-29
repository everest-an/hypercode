import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOOGLE_HANDBACK_TYPE,
  isGoogleHandback,
  waitForGoogleHandback,
} from "../src/google-return.ts";

const app = "http://localhost:8081";

test("the hand-back signal is accepted only from our own origin", () => {
  assert.equal(isGoogleHandback({ origin: app, data: { type: GOOGLE_HANDBACK_TYPE } }, app), true);
  assert.equal(
    isGoogleHandback({ origin: "http://evil.example", data: { type: GOOGLE_HANDBACK_TYPE } }, app),
    false,
  );
});

test("an unrelated message from our own origin is not treated as a completed sign-in", () => {
  assert.equal(isGoogleHandback({ origin: app, data: { type: "something-else" } }, app), false);
  assert.equal(isGoogleHandback({ origin: app, data: null }, app), false);
  assert.equal(isGoogleHandback({ origin: app, data: "hypercode:google-connected" }, app), false);
});

test("a hand-back reporting a declined consent resolves false instead of hanging", async () => {
  const listeners: ((event: { origin: string; data: unknown }) => void)[] = [];
  const realWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    location: { origin: app },
    addEventListener: (_: string, listener: (event: { origin: string; data: unknown }) => void) =>
      listeners.push(listener),
    removeEventListener: () => {},
  };
  try {
    const settled = waitForGoogleHandback({ closed: false } as unknown as Window);
    listeners[0]?.({ origin: app, data: { type: GOOGLE_HANDBACK_TYPE, ok: false } });
    assert.equal(
      await Promise.race([
        settled,
        new Promise((_, reject) => setTimeout(() => reject(new Error("never settled")), 1000)),
      ]),
      false,
    );
  } finally {
    (globalThis as { window?: unknown }).window = realWindow;
  }
});

test("a completed hand-back resolves true even before the window closes", async () => {
  const listeners: ((event: { origin: string; data: unknown }) => void)[] = [];
  const realWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    location: { origin: app },
    addEventListener: (_: string, listener: (event: { origin: string; data: unknown }) => void) =>
      listeners.push(listener),
    removeEventListener: () => {},
  };
  try {
    const settled = waitForGoogleHandback({ closed: false } as unknown as Window);
    listeners[0]?.({ origin: app, data: { type: GOOGLE_HANDBACK_TYPE, ok: true } });
    assert.equal(
      await Promise.race([
        settled,
        new Promise((_, reject) => setTimeout(() => reject(new Error("never settled")), 1000)),
      ]),
      true,
    );
  } finally {
    (globalThis as { window?: unknown }).window = realWindow;
  }
});
