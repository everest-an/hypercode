import assert from "node:assert/strict";
import { test } from "node:test";
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { assertApiDeploymentConfig, type Config } from "../apps/server/src/config.ts";

const base: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: ".hypercode",
  agentBackend: "agui",
  agentUrl: "http://127.0.0.1:8791/run",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
};

test("local threads mode boots without any cloud key", () => {
  assert.doesNotThrow(() => assertApiDeploymentConfig({ ...base, threadsMode: "local" }));
});

test("the cloud gate still closes when local mode was not chosen", () => {
  // 这是上游原本的保护：没显式选 local，缺 key 必须继续红，我不能把它拆成免检
  for (const threadsMode of [undefined, "cloud"] as const) {
    assert.throws(() => assertApiDeploymentConfig({ ...base, threadsMode }));
  }
});

test("no intelligence selects the in-process SSE runtime", () => {
  const runner = new InMemoryAgentRunner();
  const runtime = new CopilotRuntime({ agents: async () => ({}), runner });
  assert.equal(runtime.mode, "sse");
  assert.equal(runner.ɵsupportsLocalThreadEndpoints, true);
});
