# HyperCode 内网私有化部署指南

> 让 HyperCode 的数据不出域、跑在你自己内网的模型上。面向国企/央企信息中心、以及所有对数据安全有硬性要求的场景。

## 核心结论（先说透）

HyperCode 的"私有化部署"**不是重新开发一套产品**，而是：

> **把模型的 `baseURL` 从公网 API 地址，指向你内网自部署的 OpenAI 兼容推理服务。**

HyperCode 出厂默认接 DeepSeek 公网 API（`https://api.deepseek.com/v1`），但它的 provider 架构基于 `@ai-sdk/openai-compatible`——**这是 OpenAI 兼容协议的标准客户端**，意味着任何提供 OpenAI 兼容 API 的本地推理服务，都能直接接入。

所以私有化部署的关键，不是你 HyperCode 这边要改多少代码，而是：**你内网有没有一个 OpenAI 兼容的模型推理服务**。

## 支持的私有化部署方式

任何能提供 OpenAI 兼容 API（`/v1/chat/completions`）的推理引擎都可以：

| 推理引擎 | 说明 | 推荐场景 |
|---|---|---|
| **vLLM** | 高性能 GPU 推理,吞吐高 | 生产环境、多并发 |
| **Ollama** | 轻量、易部署、CPU 可跑 | 试点、小规模、快速验证 |
| **Xinference** | 国产、支持多模型 | 国内团队 |
| **TGI / SGLang** | 高性能 | 有 GPU 集群的 |

## 支持的国产模型（OpenAI 兼容）

以下国产模型均提供 OpenAI 兼容 API，可在内网自部署后接入：

- **DeepSeek**（本地版，`deepseek-ai/DeepSeek-V3` 等）
- **通义千问 Qwen**（`Qwen/Qwen2.5-72B-Instruct` 等）
- **GLM**（智谱，`THUDM/glm-4` 等）
- **Kimi / Moonshot**（`moonshotai/...` 开源版）
- **Baichuan / Yi / ChatGLM** 等

> 判断标准只有一条：**这个模型的推理服务，是否暴露了 `/v1/chat/completions` 端点**。是，就能接。

## 接入步骤

### 方式一：自定义 Provider 界面（推荐，图形化）

1. 打开 HyperCode → 模型选择器 → 「连接 Provider」
2. 选择「自定义 Provider」（Custom）
3. 填写：
   - **Provider ID**：自定义名字，如 `intranet-llm`
   - **Name**：显示名，如「内网大模型」
   - **baseURL**：`http://<内网推理服务地址>:<端口>/v1`（例如 `http://192.168.1.100:8000/v1`）
   - **apiKey**：本地推理服务通常无需 key，可填任意占位符（如 `local`）
4. 保存后，在模型列表选择你的内网模型即可。

### 方式二：config.json 直接配置（批量部署用）

在 `~/.config/opencode/opencode.json` 中写入：

```jsonc
{
  "provider": {
    "intranet-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "内网大模型",
      "options": {
        "baseURL": "http://192.168.1.100:8000/v1"
      },
      "models": {
        "qwen2.5-72b": { "name": "Qwen2.5 72B (内网)" }
      }
    }
  },
  "model": "intranet-llm/qwen2.5-72b"
}
```

保存后重启 HyperCode，即使用内网模型。

### 快速验证：用 Ollama 5 分钟跑通

最快的私有化验证路径：

```bash
# 1. 内网机器上装 Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. 拉取国产模型
ollama pull qwen2.5:14b

# 3. 启动 OpenAI 兼容端点(默认 11434 端口)
ollama serve

# 4. 验证端点
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5:14b","messages":[{"role":"user","content":"你好"}]}'
```

然后在 HyperCode 里，把 baseURL 填 `http://<内网机器IP>:11434/v1`，模型填 `qwen2.5:14b`，即可使用——**数据全程不出内网**。

## 合规要点（国企/央企必读）

私有化部署解决了"数据不出域"，但要真正过审，还需注意：

1. **等保测评**：内网推理服务所在系统需按等保要求测评（通常二级起步，涉密场景三级）
2. **商用密码**：涉及敏感数据的传输/存储，需用国密算法
3. **权限管控**：推理服务端口只对内网开放，不暴露公网
4. **日志与审计**：保留模型调用日志，便于责任追溯
5. **模型来源合规**：国产模型需确认开源协议（如 Qwen 的 Apache 2.0 / 千问协议，商用需注意条款）

## 与试点邀约的关系

本指南配合「国企 AI+ 免费私有化部署试点」（`/aiplus/pilot`）使用：

- **试点阶段**：用 Ollama + 国产模型快速验证，成本近乎为零
- **生产阶段**：迁移到 vLLM + GPU 集群，满足多并发
- **交付阶段**：由 HyperCode 团队提供一键 Docker 部署包（见下一步规划）

---

*本指南基于 HyperCode 现有能力（自定义 baseURL + OpenAI 兼容协议）编写，无需额外开发即可使用。*
