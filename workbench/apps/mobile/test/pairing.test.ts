import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostOf,
  normalizeCode,
  normalizeServerUrl,
  pairingLink,
  parsePairingLink,
} from "../src/pairing.ts";

test("a pairing link round-trips the addresses and code the computer shows", () => {
  const link = pairingLink("http://192.168.1.20:8787", "K7M2-Q9XP", [
    "https://home.example.com",
  ]);
  assert.deepEqual(parsePairingLink(link), {
    url: "http://192.168.1.20:8787",
    code: "K7M2Q9XP",
    alternates: ["https://home.example.com"],
  });
});

test("only pair links are treated as pairing", () => {
  assert.equal(parsePairingLink("https://example.com/pair?c=K7M2Q9XP"), undefined);
  assert.equal(parsePairingLink("hypercode://pair?u=file:///etc/passwd&c=K7M2Q9XP"), undefined);
  assert.equal(parsePairingLink("hypercode://pair?u=http://host:8787"), undefined);
});

test("a typed address gets a scheme, keeps its port and drops a path", () => {
  assert.equal(normalizeServerUrl("192.168.1.20:8787"), "http://192.168.1.20:8787");
  assert.equal(normalizeServerUrl("https://home.example.com/workspace/"), "https://home.example.com");
  assert.equal(normalizeServerUrl("http://user:pass@host:8787"), undefined);
  assert.equal(normalizeServerUrl("javascript:alert(1)"), undefined);
});

test("a code ignores the grouping a person may type", () => {
  assert.equal(normalizeCode("k7m2 q9xp"), "K7M2Q9XP");
  assert.equal(normalizeCode("K7M2-Q9XP"), "K7M2Q9XP");
  assert.equal(normalizeCode("k7m2-q9xp"), "K7M2Q9XP");
});

test("the host hides the scheme so two addresses read as one computer", () => {
  assert.equal(hostOf("http://192.168.1.20:8787"), "192.168.1.20:8787");
  assert.equal(hostOf("not a url"), "not a url");
});
