import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import { Pairing } from "../apps/server/src/pairing.ts";

const config: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: "",
  agentBackend: "sample",
  intelligenceApiKey: "test-project-key-never-sent",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
};

test("a pairing code is single-use, bound to its owner and expires", () => {
  let now = 1_000_000;
  const pairing = new Pairing({ ...config, host: "0.0.0.0" }, () => now);
  const created = pairing.create("u-owner");

  assert.match(created.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(created.expiresAt, now + 5 * 60 * 1000);
  assert.equal(pairing.claim(created.code.toLowerCase()), "u-owner");
  assert.throws(() => pairing.claim(created.code), /not valid/);

  const expired = pairing.create("u-owner");
  now += 5 * 60 * 1000 + 1;
  assert.throws(() => pairing.claim(expired.code), /expired/);
});

test("a loopback-only server says that a phone cannot reach it", () => {
  const pairing = new Pairing(config);
  const created = pairing.create("u-owner");

  assert.equal(created.localOnly, true);
  assert.deepEqual(created.urls, []);
});

test("a public address becomes the address the phone tries", () => {
  const pairing = new Pairing({ ...config, publicUrl: "https://home.example.com" });
  const created = pairing.create("u-owner");

  assert.equal(created.localOnly, false);
  assert.deepEqual(created.urls, ["https://home.example.com"]);
});

let db: Store;
let app: Awaited<ReturnType<typeof createApp>>["app"];
let directory: string;
let computerToken: string;
let computerOwner: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "hypercode-pairing-"));
  db = await createStore();
  ({ app } = await createApp(db, { ...config, dataDir: directory }));
  const response = await app.request("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const session = await response.json();
  computerToken = session.token;
  computerOwner = session.owner;
});
after(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

test("a pairing code only opens the workspace of the user who created it", async () => {
  const keys = ["a-private-test-key-for-alice-0000", "b-private-test-key-for-bob-000000"];
  const live = await createApp(db, {
    ...config,
    mode: "live",
    accessKey: undefined,
    accessKeys: keys,
    dataDir: directory,
  });
  try {
    const login = (accessKey: string) =>
      live.app.request("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey }),
      });
    const [alice, bob] = await Promise.all([login(keys[0]), login(keys[1])]).then((responses) =>
      Promise.all(responses.map((response) => response.json())),
    );
    assert.notEqual(alice.owner, bob.owner);

    const create = (token: string) =>
      live.app.request("/api/pairing", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
    const aliceCode = await (await create(alice.token)).json();
    const bobCode = await (await create(bob.token)).json();
    const claim = (code: string) =>
      live.app.request("/api/pairing/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

    const alicePhone = await (await claim(aliceCode.code)).json();
    const bobPhone = await (await claim(bobCode.code)).json();
    assert.equal(alicePhone.owner, alice.owner);
    assert.equal(bobPhone.owner, bob.owner);
    assert.notEqual(alicePhone.token, bobPhone.token);
    assert.equal(await live.auth.owner(`Bearer ${alicePhone.token}`), alice.owner);
    assert.equal(await live.auth.owner(`Bearer ${bobPhone.token}`), bob.owner);
  } finally {
    await live.agent.stop();
  }
});

test("a phone claims the computer's code and opens the same workspace", async () => {
  assert.equal((await app.request("/api/pairing", { method: "POST" })).status, 401);

  const created = await app.request("/api/pairing", {
    method: "POST",
    headers: { Authorization: `Bearer ${computerToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(created.status, 200);
  const pairing = await created.json();
  assert.equal(pairing.localOnly, true);

  const claim = await app.request("/api/pairing/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairing.code.toLowerCase().replace("-", " ") }),
  });
  assert.equal(claim.status, 200);
  const phone = await claim.json();
  assert.equal(phone.owner, computerOwner);
  assert.notEqual(phone.token, computerToken);

  const workspace = await app.request("/api/workspace", {
    headers: { Authorization: `Bearer ${phone.token}` },
  });
  assert.equal(workspace.status, 200);

  const logout = await app.request("/api/session/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${phone.token}` },
  });
  assert.equal(logout.status, 200);
  const revoked = await app.request("/api/workspace", {
    headers: { Authorization: `Bearer ${phone.token}` },
  });
  assert.equal(revoked.status, 401);

  const replay = await app.request("/api/pairing/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairing.code }),
  });
  assert.equal(replay.status, 401);
});
