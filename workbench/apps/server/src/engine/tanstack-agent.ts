import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import {
  BuiltInAgent,
  convertInputToTanStackAI,
  defineTool,
  type ToolDefinition,
} from "@copilotkit/runtime/v2";
import { chat, maxIterations, type SchemaInput, toolDefinition } from "@tanstack/ai";
import { type AnthropicChatModel, anthropicText } from "@tanstack/ai-anthropic";
import { type GeminiTextModel, geminiText } from "@tanstack/ai-gemini";
import { type OpenAIChatModel, openaiText } from "@tanstack/ai-openai";
import { map, mergeMap, type Observable } from "rxjs";
import { z } from "zod";
import { MODEL_MAX_RETRIES } from "../config.ts";

/**
 * A thinking-mode Responses request only accepts one shape per assistant step: the reasoning
 * item, then the assistant text, then every `function_call`, then every
 * `function_call_output`. Measured against the endpoint: text between a call and its output
 * fails with "No tool output found for tool call …"; text after the outputs fails with
 * "The `reasoning_text` in the thinking mode must be passed back"; and parallel calls split by
 * their outputs fail the same way. TanStack emits the text after the call, so the step is
 * re-sorted here. Items are only reordered — nothing is added, dropped or edited.
 */
const STEP_RANK: Record<string, number> = { reasoning: 0, message: 1, function_call: 2, function_call_output: 3 };

export function groupAssistantSteps(items: unknown[]): unknown[] {
  const kind = (item: unknown) => {
    const entry = item as { type?: string; role?: string };
    return entry?.type ?? entry?.role ?? "";
  };
  const ordered: unknown[] = [];
  let step: unknown[] = [];
  const flush = () => {
    step.sort((a, b) => (STEP_RANK[kind(a)] ?? 0) - (STEP_RANK[kind(b)] ?? 0));
    ordered.push(...step);
    step = [];
  };
  for (const item of items) {
    const type = kind(item);
    const role = (item as { role?: string }).role;
    const belongsToStep =
      type === "reasoning" ||
      type === "function_call" ||
      type === "function_call_output" ||
      (type === "message" && role !== "user" && role !== "system");
    if (!belongsToStep) {
      flush();
      ordered.push(item);
      continue;
    }
    // A reasoning item opens a new assistant step, so it must not merge with the previous one.
    if (type === "reasoning") flush();
    step.push(item);
  }
  flush();
  return ordered;
}

/**
 * A thread saved while a run was interrupted can hold a `function_call` whose output never
 * landed. Every later request for that thread then fails with "No tool output found for tool
 * call …" and the conversation is dead for good. An unanswered call gets an explicit
 * not-recorded result so the history stays usable; the model is told the result is missing
 * rather than handed invented data.
 */
export function recordMissingToolOutputs(items: unknown[]): unknown[] {
  const answered = new Set(
    items
      .map((item) => item as { type?: string; call_id?: string })
      .filter((item) => item?.type === "function_call_output" && item.call_id)
      .map((item) => item.call_id as string),
  );
  const ordered: unknown[] = [];
  for (const item of items) {
    ordered.push(item);
    const call = item as { type?: string; call_id?: string; name?: string };
    if (call?.type === "function_call" && call.call_id && !answered.has(call.call_id)) {
      answered.add(call.call_id);
      ordered.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify({ error: "No result was recorded for this call." }),
      });
    }
  }
  return ordered;
}

/** Touches only parseable /responses bodies; every other request goes out unchanged. */
function responsesFetch(input: string | URL | Request, init: RequestInit = {}) {
  if (typeof input === "string" && input.includes("/responses") && typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body) as { input?: unknown };
      if (Array.isArray(parsed.input))
        return fetch(input, {
          ...init,
          body: JSON.stringify({
            ...parsed,
            input: recordMissingToolOutputs(groupAssistantSteps(parsed.input)),
          }),
        });
    } catch {
      /* a body we cannot read is a body we must not rewrite */
    }
  }
  return fetch(input, init);
}

// Same "provider/model" strings, env vars and base URL formats as the AI SDK resolver in
// @copilotkit/runtime. Each provider SDK retries transient failures up to MODEL_MAX_RETRIES times.
function adapter(spec: string) {
  const [, provider = "", model = ""] = spec.trim().match(/^([^/:]*)[/:](.*)$/) ?? [];
  if (!provider || !model.trim())
    throw new Error(
      `Invalid model string "${spec}". Use "openai/gpt-5", "anthropic/claude-sonnet-4.5", or "google/gemini-2.5-pro".`,
    );
  const id = model.trim();
  switch (provider.toLowerCase()) {
    case "openai":
      return openaiText(id as OpenAIChatModel, {
        baseURL: process.env.OPENAI_BASE_URL,
        maxRetries: MODEL_MAX_RETRIES,
        fetch: responsesFetch,
      });
    case "anthropic":
      // The AI SDK base URL ends in /v1; the Anthropic SDK adds /v1 itself.
      return anthropicText(id as AnthropicChatModel, {
        baseURL: process.env.ANTHROPIC_BASE_URL?.replace(/\/v1\/?$/, ""),
        maxRetries: MODEL_MAX_RETRIES,
      });
    case "google":
    case "gemini":
    case "google-gemini":
      // The AI SDK base URL ends in /v1beta; @google/genai adds the API version itself.
      return geminiText(id as GeminiTextModel, {
        httpOptions: {
          baseUrl: process.env.GOOGLE_GENERATIVE_AI_BASE_URL?.replace(/\/v1beta\/?$/, ""),
          // @google/genai counts the first call in `attempts`.
          retryOptions: { attempts: MODEL_MAX_RETRIES + 1 },
        },
      });
    default:
      throw unknownProvider(provider, spec);
  }
}

/** With OPENAI_BASE_URL set, a gateway model ID most likely needs the openai/ prefix. */
export function unknownProvider(
  provider: string,
  spec: string,
  baseUrl = process.env.OPENAI_BASE_URL,
) {
  const hint = baseUrl?.trim()
    ? ` For a model on your OPENAI_BASE_URL gateway, use "openai/${spec.trim()}".`
    : "";
  return new Error(
    `Unknown provider "${provider}" in "${spec}". Supported: openai, anthropic, google (gemini).${hint}`,
  );
}

// The classic BuiltInAgent always offers these two state tools. The converter turns their
// results into STATE_SNAPSHOT / STATE_DELTA events.
const stateTools = [
  defineTool({
    name: "AGUISendStateSnapshot",
    description: "Replace the entire application state with a new snapshot",
    parameters: z.object({ snapshot: z.any().describe("The complete new state object") }),
    execute: async ({ snapshot }) => ({ success: true, snapshot }),
  }),
  defineTool({
    name: "AGUISendStateDelta",
    description: "Apply incremental updates to application state using JSON Patch operations",
    parameters: z.object({
      delta: z
        .array(
          z.object({
            op: z.enum(["add", "replace", "remove"]).describe("The operation to perform"),
            path: z.string().describe("JSON Pointer path (e.g., '/foo/bar')"),
            value: z
              .any()
              .optional()
              .describe(
                "The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'.",
              ),
          }),
        )
        .describe("Array of JSON Patch operations"),
    }),
    execute: async ({ delta }) => ({ success: true, delta }),
  }),
];

/** A BuiltInAgent in TanStack factory mode with the options of the classic AI SDK mode. */
export function tanstackAgent(options: {
  model: string;
  maxSteps: number;
  tools: ToolDefinition[];
  prompt: string;
  /** Said when the step limit, not the model, ends a run; otherwise the reply just stops. */
  stepLimitNote?: string;
}) {
  const agent = new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const converted = convertInputToTanStackAI(input);
      // Build the system prompt like the classic mode. It does not forward system messages.
      let system = options.prompt;
      if (input.context.length) {
        system += "\n## Context from the application\n";
        for (const ctx of input.context) system += `${ctx.description}:\n${ctx.value}\n`;
      }
      if (
        input.state !== undefined &&
        input.state !== null &&
        !(typeof input.state === "object" && Object.keys(input.state).length === 0)
      )
        system += `\n## Application State\nThis is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n\`\`\`json\n${JSON.stringify(input.state, null, 2)}\n\`\`\`\n`;
      return chat({
        adapter: adapter(options.model),
        messages: converted.messages,
        systemPrompts: system ? [system] : [],
        tools: [
          ...converted.tools,
          ...[...options.tools, ...stateTools].map((tool) =>
            toolDefinition({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.parameters as SchemaInput,
            }).server((args) => (tool.execute as (args: unknown) => Promise<unknown>)(args)),
          ),
        ],
        agentLoopStrategy: maxIterations(options.maxSteps),
        abortController,
      });
    },
  });
  const run = agent.run.bind(agent);
  agent.run = (input: RunAgentInput) => {
    const events = splitTextAtToolCalls(run(input));
    return options.stepLimitNote
      ? reportStepLimit(events, options.maxSteps, options.stepLimitNote)
      : events;
  };
  return agent;
}

/**
 * maxIterations ends the loop after the last allowed tool step without a final model reply.
 * When a run ends that way, add a short assistant message so it does not stop silently.
 */
export function reportStepLimit(events: Observable<BaseEvent>, maxSteps: number, note: string) {
  let steps = 0;
  let phase: "text" | "calling" | "results" = "text";
  return events.pipe(
    mergeMap((event): BaseEvent[] => {
      if (event.type === EventType.TOOL_CALL_START) {
        // Parallel calls of one model step arrive together; results end the step.
        if (phase !== "calling") steps++;
        phase = "calling";
      } else if (event.type === EventType.TOOL_CALL_RESULT) phase = "results";
      else if (event.type === EventType.TEXT_MESSAGE_CHUNK) phase = "text";
      else if (event.type === EventType.RUN_FINISHED && phase === "results" && steps >= maxSteps)
        return [
          {
            type: EventType.TEXT_MESSAGE_CHUNK,
            messageId: randomUUID(),
            role: "assistant",
            delta: note,
          } as BaseEvent,
          event,
        ];
      return [event];
    }),
  );
}

// ponytail: the TanStack converter in @copilotkit/runtime 1.70.1 uses one message ID for the
// whole run. Remove this when it starts a new ID for each step, like the classic mode does.
// Text after a tool call gets a new message ID, so each step's text is a separate message.
function splitTextAtToolCalls(events: Observable<BaseEvent>) {
  let messageId: string | undefined;
  let afterToolCall = false;
  return events.pipe(
    map((event) => {
      if (event.type === EventType.TEXT_MESSAGE_CHUNK) {
        if (!messageId || afterToolCall) messageId = randomUUID();
        afterToolCall = false;
        return { ...event, messageId };
      }
      if (event.type === EventType.TOOL_CALL_START) {
        afterToolCall = true;
        return messageId ? { ...event, parentMessageId: messageId } : event;
      }
      if (event.type === EventType.TOOL_CALL_RESULT) afterToolCall = true;
      return event;
    }),
  );
}
