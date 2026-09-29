#!/usr/bin/env node
// HyperCode 命令行：一条命令拉起 AG-UI shim + 本地 API（可选 web）。
// 只做编排，不改运行时行为；所有判据仍由 apps/server 自己的 config.ts 把关。
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0] ?? "start";

const SHIM_DIR = process.env.HYPERCODE_SHIM_DIR ?? resolve(ROOT, "../hc-agui");
const WEB = args.includes("--web");
const AUTO = args.includes("--auto") || process.env.HC_AUTO === "1";
const NO_SHIM = args.includes("--no-shim");

function envFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// .env 必须盖过 .env.example：反过来会被模板里的示例端口（8787，本机已被占用）顶掉
const dotenv = { ...envFile(join(ROOT, ".env.example")), ...envFile(join(ROOT, ".env")) };
const env = (k) => process.env[k] ?? dotenv[k] ?? "";
const SHIM_PORT = Number(env("SHIM_PORT") || 8791);
const API_PORT = Number(env("API_PORT") || env("PORT") || 8787);
const MODEL = env("HC_MODEL") || "deepseek/deepseek-flash";
// 引擎默认就在旁边的 hypercode 仓里；不让用户每次手搓 HC_ENGINE_CMD
const ENGINE =
  env("HC_ENGINE_CMD") ||
  `bun --conditions=browser ${resolve(ROOT, "../hypercode/packages/opencode/src/index.ts")} run -m ${MODEL}`;
const HC_DIR = env("HC_DIR") || process.cwd();
const children = [];

function run(label, file, argv, opts = {}) {
  const child = spawn(file, argv, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    console.log(`[hypercode] ${label} 退出 code=${code}`);
    for (const c of children) if (c !== child) c.kill("SIGTERM");
    process.exit(code ?? 0);
  });
  children.push(child);
  console.log(`[hypercode] 启动 ${label}: ${file} ${argv.join(" ")}`);
  return child;
}

async function doctor() {
  let health = "未监听（正常，start 后才有）";
  try {
    const r = await fetch(`http://127.0.0.1:${API_PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    health = `已在监听 HTTP ${r.status}`;
  } catch {}
  const checks = [
    ["API 端口", health],
    [
      "CPK_INTELLIGENCE_API_KEY",
      env("CPK_INTELLIGENCE_API_KEY")
        ? "已设置 → 线程走 CopilotKit 云（持久化/回放/跨设备）"
        : "未设置 → 自动 HYPERCODE_THREADS=local：全本机，重启后会话历史不保留（任务/审批/产物仍在本地库）",
    ],
    ["AGENT_BACKEND", env("AGENT_BACKEND") || "未设 → 默认 sample/model；接 hypercode 要 agui"],
    [
      "shim 目录",
      existsSync(join(SHIM_DIR, "shim.ts")) ? SHIM_DIR : `缺失（HYPERCODE_SHIM_DIR=${SHIM_DIR}）`,
    ],
    [
      "模型凭证 DEEPSEEK_API_KEY",
      env("DEEPSEEK_API_KEY") ? "已在环境里" : "缺失 → 引擎会回 Authorization Required",
    ],
    ["HC_ENGINE_CMD", env("HC_ENGINE_CMD") || "未设 → shim 会报引擎未配置"],
  ];
  for (const [k, v] of checks) console.log(`  ${String(k).padEnd(30)} ${v}`);
  process.exit(existsSync(join(SHIM_DIR, "shim.ts")) ? 0 : 1);
}

if (cmd === "doctor") await doctor();

if (cmd === "start") {
  // 大脑由 .env 的 AGENT_BACKEND 决定：agui=外部 hypercode，model=OpenMuse 内建 agent（带 browse_web 等工具）
  const backend = env("AGENT_BACKEND") || "agui";
  if (!NO_SHIM && backend === "agui") {
    if (!existsSync(join(SHIM_DIR, "shim.ts"))) {
      console.error(
        `[hypercode] 找不到 shim：${SHIM_DIR}/shim.ts（用 HYPERCODE_SHIM_DIR 指，或加 --no-shim 只起 API）`,
      );
      process.exit(1);
    }
    run("shim", "bun", ["shim.ts"], {
      cwd: SHIM_DIR,
      env: {
        PORT: String(SHIM_PORT),
        HC_ENGINE_CMD: ENGINE,
        HC_DIR,
        HC_AUTO: AUTO ? "1" : "",
      },
    });
  }

  const apiEnv = {
    PORT: String(API_PORT),
    AGENT_BACKEND: backend,
    ...(backend === "agui"
      ? { AGENT_URL: env("AGENT_URL") || `http://127.0.0.1:${SHIM_PORT}/run` }
      : {}),
    ...(env("AGENT_TOKEN") ? { AGENT_TOKEN: env("AGENT_TOKEN") } : {}),
    // 没有云 key 就明确走本地线程模式，而不是让 config.ts 抛
    ...(env("CPK_INTELLIGENCE_API_KEY") ? {} : { HYPERCODE_THREADS: "local" }),
  };
  console.log(
    `[hypercode] 线程模式：${apiEnv.HYPERCODE_THREADS === "local" ? "local（无云依赖，重启丢会话历史）" : "cloud（CopilotKit Intelligence）"}`,
  );
  run("api", "pnpm", ["exec", "tsx", "apps/server/src/index.ts"], { env: apiEnv });
  if (WEB)
    run("web", "pnpm", ["dev:web"], {
      env: { EXPO_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
    });
  console.log(
    `[hypercode] API http://127.0.0.1:${API_PORT}  大脑=${backend}` +
      (apiEnv.AGENT_URL ? `  agent→ ${apiEnv.AGENT_URL}` : `  模型=${env("MODEL") || "未设"}`),
  );
  process.on("SIGINT", () => {
    for (const c of children) c.kill("SIGTERM");
  });
}

if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  console.log(`用法：hypercode [start|doctor] [--web] [--no-shim] [--auto]
  start   拉起 AG-UI shim + 本地 API（--web 同时起 Expo web）
  doctor  检查起得来不起：Intelligence key、shim 目录、模型凭证
环境变量：HYPERCODE_SHIM_DIR SHIM_PORT PORT AGENT_TOKEN HC_ENGINE_CMD DEEPSEEK_API_KEY`);
}
