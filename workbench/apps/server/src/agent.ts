import "./config.ts";
import { HttpAgent } from "@ag-ui/client";
import {
  type AgentsFactory,
  type CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { Auth } from "./auth.ts";
import type { Config } from "./config.ts";
import { ConversationAgent } from "./engine/conversation.ts";
import type { AgentService } from "./engine/service.ts";

export function agentConfigured(config: Config) {
  return (
    config.agentBackend === "sample" ||
    (config.agentBackend === "agui"
      ? Boolean(config.agentUrl)
      : Boolean(
          config.model &&
            (process.env.OPENAI_API_KEY ||
              process.env.ANTHROPIC_API_KEY ||
              process.env.GOOGLE_API_KEY),
        ))
  );
}
export function makeRuntime(
  config: Config,
  service: AgentService,
  auth: Auth,
  intelligence?: CopilotKitIntelligence,
) {
  const agents: AgentsFactory = async ({ request }) => ({
    default:
      config.agentBackend === "sample"
        ? new ConversationAgent(
            config,
            service,
            await auth.owner(request.headers.get("authorization") ?? undefined),
          )
        : config.agentBackend === "agui"
          ? new HttpAgent({
              url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
              headers: config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {},
            })
          : new ConversationAgent(
              config,
              service,
              await auth.owner(request.headers.get("authorization") ?? undefined),
            ),
  });
  const identifyUser = async (request: Request) => ({
    id: await auth.owner(request.headers.get("authorization") ?? undefined),
    name: "HyperCode user",
  });
  // 没有 Intelligence 时走 SDK 自带的 SSE 模式：线程活在 InMemoryAgentRunner 里，无云依赖，
  // 代价是 API 重启后线程历史不保留（任务、审批、产物仍在本地 PGlite）。
  const runtime = intelligence
    ? new CopilotRuntime({
        agents,
        intelligence,
        identifyUser,
        generateThreadNames: false,
      })
    : new CopilotRuntime({ agents, runner: new InMemoryAgentRunner(), identifyUser });
  return createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
}
