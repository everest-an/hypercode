#!/usr/bin/env bash
# ============================================================
# launch-workspace.sh —— 为一个租户(workspace)拉起隔离沙箱
# 用法: launch-workspace.sh <workspaceId> [repoUrl]
# 多租户：每个 workspaceId 对应 1 个容器 + 1 个持久卷 + 独立网络别名
# ============================================================
set -euo pipefail

WS_ID="${1:?usage: launch-workspace.sh <workspaceId> [repoUrl]}"
REPO_URL="${2:-}"

# ---- 可通过环境变量覆盖 ----
IMAGE="${HC_SANDBOX_IMAGE:-hypercode-sandbox:latest}"
NET="${HC_NETWORK:-hc-sandbox}"                         # 专用网络，不与 awareness-box 同网
ROOT="${HC_WORKSPACE_ROOT:-/srv/hypercode/workspaces}"  # 持久卷根目录
PWA_ORIGIN="${HC_PWA_ORIGIN:-https://cloud.awareliquid.ai}"
SECRETS_ENV="${HC_SECRETS_ENV:-/etc/hypercode/sandbox.env}"  # 模型 key 等(不入 git)
MEM="${HC_MEM:-2g}"
CPUS="${HC_CPUS:-2}"
PIDS="${HC_PIDS:-512}"
PORT="${HC_PORT:-4096}"

# ---- 运行时自动探测：有 gVisor 用 runsc，否则 runc(降级并告警) ----
if [[ "${HC_RUNTIME:-auto}" == "auto" ]]; then
  if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"'; then
    RUNTIME="runsc"
  else
    RUNTIME="runc"
    echo "[warn] 未检测到 gVisor(runsc)，回退到 runc —— 隔离强度较低，上线前请安装 gVisor(见 README)" >&2
  fi
else
  RUNTIME="${HC_RUNTIME}"
fi

NAME="hc-ws-${WS_ID}"
WS_DIR="${ROOT}/${WS_ID}"

# ---- 准备卷目录(uid 10001) + 预先建好 .hc(会被卷覆盖，必须在宿主侧建) ----
mkdir -p "${WS_DIR}/.hc/home" "${WS_DIR}/.hc/config" "${WS_DIR}/.hc/data" "${WS_DIR}/.hc/cache"
chown -R 10001:10001 "${WS_DIR}" 2>/dev/null || sudo chown -R 10001:10001 "${WS_DIR}"

# ---- 专用网络(仅建一次) ----
docker network inspect "${NET}" >/dev/null 2>&1 || docker network create "${NET}"

# ---- 幂等：同名容器先清掉(卷保留) ----
docker rm -f "${NAME}" >/dev/null 2>&1 || true

ENV_FILE_ARGS=()
if [[ -f "${SECRETS_ENV}" ]]; then
  ENV_FILE_ARGS=(--env-file "${SECRETS_ENV}")
else
  echo "[warn] 未找到 ${SECRETS_ENV}（模型 key 未注入，agent 可能无法调模型）" >&2
fi

docker run -d --name "${NAME}" \
  --runtime "${RUNTIME}" \
  --network "${NET}" --network-alias "${NAME}" \
  --hostname "${NAME}" \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --tmpfs /run:rw,nosuid,nodev,size=64m \
  -v "${WS_DIR}:/workspace:rw" \
  --user 10001:10001 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --pids-limit "${PIDS}" --memory "${MEM}" --cpus "${CPUS}" \
  --restart unless-stopped \
  --label hc.workspace="${WS_ID}" \
  --label hc.tenant="true" \
  ${ENV_FILE_ARGS[@]+"${ENV_FILE_ARGS[@]}"} \
  -e HC_WORKSPACE_ID="${WS_ID}" \
  "$IMAGE" \
  --hostname 0.0.0.0 --port "${PORT}" --cors "${PWA_ORIGIN}"

# ---- 可选：首次克隆仓库 ----
if [[ -n "${REPO_URL}" ]]; then
  echo "cloning ${REPO_URL} -> /workspace/repo ..."
  docker exec -u 10001:10001 "${NAME}" sh -lc \
    "test -d /workspace/repo/.git || git clone '${REPO_URL}' /workspace/repo"
fi

# ---- 健康检查(容器内自检) ----
READY="no"
for i in $(seq 1 30); do
  code="$(docker exec "${NAME}" sh -lc "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/api/info 2>/dev/null" 2>/dev/null || true)"
  if [[ -n "${code}" && "${code}" != "000" ]]; then
    READY="yes (HTTP ${code})"
    break
  fi
  sleep 0.5
done
if [[ "${READY}" == "no" ]]; then
  echo "[warn] 沙箱 API 15s 内未响应，请查看: docker logs ${NAME}" >&2
fi

cat <<EOF
workspace   : ${WS_ID}
container   : ${NAME}  (runtime=${RUNTIME})
volume      : ${WS_DIR} -> /workspace
network     : ${NET}  (alias ${NAME}:${PORT}, 仅本网络内可解析)
exposed     : http://${NAME}:${PORT}  (由网关反代，勿直接对外)
EOF
