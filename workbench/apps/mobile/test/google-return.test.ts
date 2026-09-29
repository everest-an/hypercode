import assert from "node:assert/strict";
import { test } from "node:test";
import { GOOGLE_HANDBACK_TYPE, isGoogleHandback } from "../src/google-return.ts";

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
