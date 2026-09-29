import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { Auth } from "../apps/server/src/auth.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import { Files } from "../apps/server/src/files.ts";
import { GoogleAuth } from "../apps/server/src/google-auth.ts";
import { WorkspaceService } from "../apps/server/src/workspace.ts";
import type { Mail } from "../packages/domain/src/index.ts";
import type { GoogleClient } from "../packages/integrations/src/google.ts";
import { GoogleApiError } from "../packages/integrations/src/google.ts";

const owner = "degradation-user";

function liveConfig(): Config {
  return {
    mode: "live",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: "unused",
    agentBackend: "model",
    allowedOrigins: [],
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    encryptionKey: randomBytes(32).toString("base64"),
  };
}

function cachedMail(id: string): Mail {
  return {
    id,
    threadId: `t-${id}`,
    from: "someone@example.com",
    sender: "Someone",
    to: ["you@example.com"],
    subject: `cached ${id}`,
    body: "body",
    date: "2026-09-29T00:00:00.000Z",
    unread: false,
    label: "Inbox",
    attachments: [],
  };
}

/** The only seam we need is the Google client itself; everything else is the real service. */
class Faked extends WorkspaceService {
  calls = { mail: 0, events: 0 };
  failMail: unknown = null;
  failEvents: unknown = null;
  override connected() {
    return Promise.resolve(true);
  }
  override connection() {
    return Promise.resolve({ id: "connection-1", account: "you@example.com" });
  }
  override google(): GoogleClient {
    return {
      listMail: async () => {
        this.calls.mail++;
        if (this.failMail) throw this.failMail;
        return [];
      },
      listEvents: async () => {
        this.calls.events++;
        if (this.failEvents) throw this.failEvents;
        return [];
      },
    } as unknown as GoogleClient;
  }
}

async function fixture() {
  const db = await createStore();
  const config = liveConfig();
  const auth = new Auth(db, config, "test-signing-key");
  const files = new Files(db, config, auth);
  const service = new Faked(db, config, files, new GoogleAuth(db, config));
  return { db, service };
}

test("one failed Google read degrades that source instead of failing the whole snapshot", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.close());
  await db.put(owner, "mail", { ...cachedMail("cached-1"), connectionId: "connection-1" });
  await db.put(owner, "browsers", {
    id: "session-1",
    url: "https://example.com",
    status: "active",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  });
  service.failMail = new GoogleApiError(403, "Quota exceeded for quota metric 'Total Query Cost'.");
  const snapshot = await service.snapshot(owner);
  assert.deepEqual(
    snapshot.degraded?.map((d) => d.source),
    ["mail"],
    "only the leg that failed is marked",
  );
  assert.equal(snapshot.mail.length, 1, "the failed leg falls back to the cached copy");
  assert.equal(snapshot.browsers.length, 1, "the browser cards survive a Google failure");
  assert.equal(snapshot.connections.find((c) => c.id === "google")?.status, "connected");
});

test("a quota refusal pauses Google reads so the 3s poll stops burning the bucket", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.close());
  service.failMail = new GoogleApiError(403, "Quota exceeded");
  service.failEvents = new GoogleApiError(429, "Too many requests");
  await service.snapshot(owner);
  assert.deepEqual([service.calls.mail, service.calls.events], [1, 1], "first pass hits Google");
  await service.snapshot(owner);
  assert.deepEqual(
    [service.calls.mail, service.calls.events],
    [1, 1],
    "the pause holds Google off",
  );
  const paused = await service.snapshot(owner);
  assert.equal(paused.degraded?.length, 2, "and the page still says it is serving cache");
});

test("a non-quota failure is not hidden behind a pause window", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.close());
  service.failMail = new Error("Could not reach Google; check the connection and try again");
  await service.snapshot(owner);
  assert.equal(service.googlePausedUntil.size, 0, "a network blip must not pause reads");
  await service.snapshot(owner);
  assert.equal(service.calls.mail, 2, "the next poll is allowed to try Google again");
});

test("the pause expires instead of wedging the workspace", async (t) => {
  const { db, service } = await fixture();
  t.after(() => db.close());
  service.failMail = new GoogleApiError(403, "Quota exceeded");
  await service.snapshot(owner);
  assert.equal(service.googlePausedUntil.size, 1, "the quota error armed the pause");
  service.googlePausedUntil.clear();
  service.failMail = null;
  const recovered = await service.snapshot(owner);
  assert.equal(service.calls.mail, 2, "after the window the reads resume on their own");
  assert.equal(recovered.degraded, undefined, "and a clean pass stops claiming degradation");
});
