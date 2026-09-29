import assert from "node:assert/strict";
import { test } from "node:test";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import {
  groupAssistantSteps,
  recordMissingToolOutputs,
  tanstackAgent,
} from "../apps/server/src/engine/tanstack-agent.ts";
import { modelFixture } from "./helpers/model.ts";

const run = (agent: ReturnType<typeof tanstackAgent>) => {
  const input: RunAgentInput = {
    threadId: "tool-order",
    runId: "tool-order-run",
    messages: [{ id: "m1", role: "user", content: "Read the page." }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  };
  return new Promise<{ error?: string; finished: boolean }>((resolve) => {
    let error: string | undefined;
    let finished = false;
    agent.run(input).subscribe({
      next: (event) => {
        if (event.type === EventType.RUN_ERROR && "message" in event) error = String(event.message);
        if (event.type === EventType.RUN_FINISHED) finished = true;
      },
      error: (cause) => resolve({ error: error ?? String(cause), finished: false }),
      complete: () => resolve({ error, finished }),
    });
  });
};

const probeTool = defineTool({
  name: "probe",
  description: "Read a public page",
  parameters: z.object({ url: z.string() }),
  execute: async () => ({ title: "Fixture page" }),
});

/** Items of the second provider request, in the order the provider will read them. */
const secondRequestItems = (body: string) => {
  const parsed = JSON.parse(body) as { input: { type: string; call_id?: string }[] };
  return parsed.input;
};

test("a tool call and its output stay adjacent even when the model trails the call with text", async (t) => {
  const { requests } = await modelFixture(t, (index) =>
    index === 0
      ? { name: "probe", arguments: { url: "https://example.com" }, text: "I'll read it now." }
      : undefined,
  );
  const outcome = await run(tanstackAgent({ model: "openai/fixture", maxSteps: 3, tools: [probeTool], prompt: "Read the page." }));
  assert.equal(outcome.error, undefined);
  assert.equal(requests.length, 2, "the tool result must come back to the model");
  const items = secondRequestItems(requests[1].body);
  const call = items.findIndex((item) => item.type === "function_call");
  const output = items.findIndex((item) => item.type === "function_call_output");
  assert.ok(call >= 0 && output >= 0, `expected a call and its output, got ${items.map((i) => i.type)}`);
  assert.equal(output, call + 1, "a provider rejects any item between a call and its output");
});

test("reordering never drops, duplicates or invents an item", async (t) => {
  const { requests } = await modelFixture(t, (index) =>
    index === 0 ? { name: "probe", arguments: { url: "https://example.com" }, text: "Reading." } : undefined,
  );
  await run(tanstackAgent({ model: "openai/fixture", maxSteps: 3, tools: [probeTool], prompt: "Read the page." }));
  const items = secondRequestItems(requests[1].body);
  const first = secondRequestItems(requests[0].body);
  // Everything the model was already told about is still there, exactly once.
  for (const item of first)
    assert.equal(
      items.filter((next) => next === item || (next.type === item.type && next.call_id === item.call_id)).length >= 1,
      true,
      `lost ${item.type}`,
    );
  const calls = items.filter((item) => item.type === "function_call");
  const outputs = items.filter((item) => item.type === "function_call_output");
  assert.equal(calls.length, 1);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].call_id, calls[0].call_id);
});

test("a call left unanswered in stored history gets an explicit not-recorded result", () => {
  const items = recordMissingToolOutputs([
    { type: "message", role: "user" },
    { type: "function_call", call_id: "call-orphan", name: "probe", arguments: "{}" },
  ]);
  assert.deepEqual(
    items.map((item) => (item as { type: string }).type),
    ["message", "function_call", "function_call_output"],
  );
  const added = items[2] as { output: string };
  assert.match(added.output, /No result was recorded/);
});

test("an answered call is left alone instead of getting a second output", () => {
  const items = recordMissingToolOutputs([
    { type: "function_call", call_id: "call-1", name: "probe", arguments: "{}" },
    { type: "function_call_output", call_id: "call-1", output: "{}" },
  ]);
  assert.equal(items.length, 2);
  assert.equal(
    items.filter((item) => (item as { type: string }).type === "function_call_output").length,
    1,
  );
});

const kinds = (items: unknown[]) =>
  items.map((item) => (item as { type: string }).type ?? (item as { role: string }).role);

test("parallel calls stay in one block with their outputs in another", () => {
  // What the endpoint accepts (200) is reasoning, text, all calls, all outputs. Pairing each
  // output with its own call instead is what produced the reasoning_text 400.
  const grouped = groupAssistantSteps([
    { type: "message", role: "user" },
    { type: "reasoning", id: "r1" },
    { type: "function_call", call_id: "A" },
    { type: "function_call_output", call_id: "A" },
    { type: "function_call", call_id: "B" },
    { type: "function_call_output", call_id: "B" },
    { type: "message", role: "assistant" },
  ]);
  assert.deepEqual(kinds(grouped), [
    "message",
    "reasoning",
    "message",
    "function_call",
    "function_call",
    "function_call_output",
    "function_call_output",
  ]);
});

test("a new reasoning item opens a new step instead of merging with the previous one", () => {
  const grouped = groupAssistantSteps([
    { type: "reasoning", id: "r1" },
    { type: "function_call", call_id: "A" },
    { type: "function_call_output", call_id: "A" },
    { type: "reasoning", id: "r2" },
    { type: "message", role: "assistant" },
    { type: "function_call", call_id: "B" },
    { type: "function_call_output", call_id: "B" },
  ]);
  assert.deepEqual(kinds(grouped), [
    "reasoning",
    "function_call",
    "function_call_output",
    "reasoning",
    "message",
    "function_call",
    "function_call_output",
  ]);
});
