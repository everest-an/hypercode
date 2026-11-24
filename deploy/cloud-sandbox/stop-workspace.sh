#!/usr/bin/env bash
# ============================================================
# stop-workspace.sh —— 停止某租户沙箱(保留持久卷，计费停)
# 用法: stop-workspace.sh <workspaceId>
# ============================================================
set -euo pipefail

WS_ID="${1:?usage: stop-workspace.sh <workspaceId>}"
ROOT="${HC_WORKSPACE_ROOT:-/srv/hypercode/workspaces}"
NAME="hc-ws-${WS_ID}"

if docker inspect "${NAME}" >/dev/null 2>&1; then
  # 先给 agent 一点时间优雅退出
  docker stop -t 30 "${NAME}" >/dev/null 2>&1 || true
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  echo "stopped ${NAME}"
else
  echo "no such container: ${NAME} (already stopped?)"
fi

echo "workspace data kept at: ${ROOT}/${WS_ID}"
