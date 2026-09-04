# HyperCode 内网私有化部署包

一键启动 OpenAI 兼容的内网大模型推理服务，供 HyperCode 接入，**数据全程不出内网**。

## 这是什么

一个基于 Ollama 的 Docker 部署包，让你在**自己内网的机器**上跑一个国产大模型（默认 Qwen），然后 HyperCode 通过自定义 baseURL 指向它。适合：

- 国企/央企「数据不出域」的硬性要求
- 涉密/敏感数据场景
- 无公网环境

## 前置条件

- 一台内网机器（Linux，4 核 16G 内存可跑 qwen2.5:14b；有 GPU 更快）
- 安装了 Docker + Docker Compose

## 三步启动

```bash
# 1. 启动推理服务
docker compose up -d

# 2. 拉取国产模型(默认 qwen2.5:14b,约 9GB)
bash pull-models.sh

# 3. 验证端点(返回 200 即成功)
curl http://localhost:11434/v1/models
```

## 接入 HyperCode

1. 打开 HyperCode → 模型选择器 → 「连接 Provider」→「自定义 Provider」
2. 填写：
   - **baseURL**：`http://<内网机器IP>:11434/v1`
   - **apiKey**：本地服务无需鉴权，填任意占位符（如 `local`）
   - **模型名**：`qwen2.5:14b`
3. 保存，选择该模型即可使用

## 模型选择

| 模型 | 内存需求 | 适用 |
|---|---|---|
| `qwen2.5:7b` | ~8G | 快速验证、低配机器 |
| `qwen2.5:14b` | ~16G | 平衡效果与资源(默认) |
| `qwen2.5:32b` | ~32G | 效果更好,需 GPU |

其他国产模型（DeepSeek / GLM / Baichuan 等）替换 `pull-models.sh` 的模型名即可。

## 合规提示

- **端口不要暴露公网**（本部署默认只监听内网）
- 涉密场景需配合等保测评、国密算法
- 模型开源协议商用前请确认条款

## 生产环境迁移

试点验证后，生产环境建议迁移到 **vLLM**（GPU 高性能推理，多并发）。部署包架构相同，仅替换推理引擎镜像。详见 `docs/private-deployment.md`。
