import assert from "node:assert/strict";
import { test } from "node:test";
import { probeFailureIsReportable } from "../src/session-probe.ts";

test("the mount probe's 401 is not shown as a wrong access key", () => {
  assert.equal(probeFailureIsReportable(401, false), false);
});

test("a key the person actually typed is still rejected out loud", () => {
  assert.equal(probeFailureIsReportable(401, true), true);
});

test("a dead or faulting server keeps reporting, because nothing else would", () => {
  // fetch failure carries no status at all
  assert.equal(probeFailureIsReportable(undefined, false), true);
  assert.equal(probeFailureIsReportable(500, false), true);
  assert.equal(probeFailureIsReportable(503, false), true);
});
