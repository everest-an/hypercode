#!/usr/bin/env bash
# 拉取国产大模型(OpenAI 兼容,供 HyperCode 内网接入)
# 用法: bash pull-models.sh [模型名]
#   不带参数: 拉取推荐的 qwen2.5:14b(平衡效果与资源)
#   示例: bash pull-models.sh qwen2.5:32b
set -euo pipefail

MODEL="${1:-qwen2.5:14b}"

echo "==> 拉取模型: ${MODEL}"
echo "    (若内网无法访问 ollama.com,请提前配置模型镜像源)"

docker compose exec ollama ollama pull "${MODEL}"

echo ""
echo "==> 完成。可用模型:"
docker compose exec ollama ollama list

echo ""
echo "==> HyperCode 接入配置:"
echo "    baseURL = http://<本机内网IP>:11434/v1"
echo "    model   = ${MODEL}"
