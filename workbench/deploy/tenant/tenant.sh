#!/usr/bin/env bash
# ============================================================
# tenant.sh —— 每租户（多客户）云 workspace 的开通/回收
# 用法:
#   sudo ./tenant.sh provision <tenantId> <hostPort>
#   sudo ./tenant.sh status    <tenantId>
#   sudo ./tenant.sh destroy   <tenantId>
#
# 依赖：docker + docker compose v2 + docker-ce-rootless-extras(uidmap/slirp4netns/fuse-overlayfs) + openssl
# X2 模型：单机 + 每租户独立 rootless Docker（server 只连本租户 socket）
# ============================================================
set -euo pipefail

CMD="${1:?usage: tenant.sh <provision|status|destroy> <tenantId> [hostPort]}"
TID="${2:?tenantId required}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"       # .../workbench/deploy/tenant
WB_ROOT="$(cd "${ROOT_DIR}/../.." && pwd)"                      # .../workbench
TENANTS="${HC_TENANTS_DIR:-/srv/hypercode/tenants}"
RUN_USER="hc-${TID}"
BASE_DOMAIN="${HC_BASE_DOMAIN:-cloud.awareliquid.ai}"
ENVF="${TENANTS}/${TID}.env"

compose() { docker compose -p "hc-${TID}" --env-file "${ENVF}" -f "${ROOT_DIR}/docker-compose.tenant.yml" "$@"; }

case "${CMD}" in
provision)
  HOST_PORT="${3:?hostPort required}"

  # 1) 租户系统用户 + linger
  if ! id "${RUN_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${RUN_USER}"
    echo "[*] created user ${RUN_USER}"
  fi
  TUID="$(id -u "${RUN_USER}")"; TGID="$(id -g "${RUN_USER}")"
  loginctl enable-linger "${RUN_USER}"

  # 2) 每租户 rootless docker（一次性初始化）
  SOCK="/run/user/${TUID}/docker.sock"
  if [[ ! -S "${SOCK}" ]]; then
    echo "[*] init rootless docker for ${RUN_USER} ..."
    sudo -u "${RUN_USER}" XDG_RUNTIME_DIR="/run/user/${TUID}" bash -lc \
      'command -v dockerd-rootless-setuptool.sh >/dev/null || { echo "缺 docker-ce-rootless-extras"; exit 1; }
       dockerd-rootless-setuptool.sh install || true
       systemctl --user enable --now docker' || true
    sleep 3
  fi
  [[ -S "${SOCK}" ]] || { echo "[x] rootless docker socket 未就绪: ${SOCK}"; exit 1; }

  # 3) 目录
  mkdir -p "${TENANTS}/${TID}/data"
  chown -R "${TUID}:${TGID}" "${TENANTS}/${TID}"

  # 4) 生成租户 env（首次）
  if [[ ! -f "${ENVF}" ]]; then
    cat > "${ENVF}" <<EOF
TENANT_ID=${TID}
HOST_PORT=${HOST_PORT}
TENANT_UID=${TUID}
TENANT_GID=${TGID}
TENANT_DOCKER_SOCKET=${SOCK}
HC_TENANT_DATA_DIR=${TENANTS}/${TID}/data
PUBLIC_API_URL=https://${TID}.${BASE_DOMAIN}
ALLOWED_ORIGINS=https://${TID}.${BASE_DOMAIN},http://localhost:8081
MODEL=${HC_MODEL:-openai/deepseek-chat}
OPENAI_BASE_URL=${HC_MODEL_BASE_URL:-https://api.deepseek.com/v1}
OPENAI_API_KEY=${HC_MODEL_KEY:-}
PG_PASSWORD=$(openssl rand -hex 16)
WORKER_TOKEN=$(openssl rand -hex 24)
HYPERCODE_ACCESS_KEY=$(openssl rand -hex 24)
TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
CPK_INTELLIGENCE_API_KEY=${HC_CPK_KEY:-}
HYPERCODE_THREADS=${HC_THREADS:-cloud}
EOF
    chmod 600 "${ENVF}"
    echo "[*] wrote ${ENVF}"
  fi
  set -a; . "${ENVF}"; set +a

  # 5) 构建镜像：宿主 daemon(server/worker) + 本租户 daemon(computer)
  echo "[*] building server/worker images ..."
  docker build -f "${ROOT_DIR}/Dockerfile.server" -t hypercode-server:local "${WB_ROOT}"
  docker build -t hypercode-worker:local "${WB_ROOT}/apps/worker"
  echo "[*] building computer image inside tenant daemon ..."
  DOCKER_HOST="unix://${SOCK}" docker build -t hypercode-computer:local "${WB_ROOT}/apps/computer"

  # 6) 起栈
  compose up -d

  # 7) 提示 Caddy 路由
  cat <<EOF

[ok] tenant ${TID} up on 127.0.0.1:${HOST_PORT}
[*] 在宿主机 Caddy 加:

${TID}.${BASE_DOMAIN} {
    reverse_proxy 127.0.0.1:${HOST_PORT}
}

[*] 访问密钥(分发给该客户, 24+ 字符): ${HYPERCODE_ACCESS_KEY}
EOF
  ;;

status)
  compose ps
  ;;

destroy)
  compose down -v || true
  rm -f "${ENVF}"
  echo "[ok] destroyed ${TID} (data kept at ${TENANTS}/${TID}; user ${RUN_USER} kept)"
  ;;

*)
  echo "unknown cmd: ${CMD}"; exit 1;;
esac
