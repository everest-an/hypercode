#!/usr/bin/env bash
# ============================================================
# enable-domain.sh —— 给一个租户绑定公网域名（证书 + nginx + 租户 env + 验证）
# 用法（在 workbench/deploy/tenant 目录）：
#   sudo ./enable-domain.sh <tenantId> <fqdn> <hostPort>
# 例：
#   sudo ./enable-domain.sh acme acme.cloud.awareliquid.ai 18001
#
# 前置：该 fqdn 的 A 记录已指向本机公网 IP；本机 80 端口对 Let's Encrypt 可达。
# 环境变量可覆盖：HC_NGINX_CONF_DIR / HC_CERTBOT_CONTAINER / HC_NGINX_CONTAINER /
#                HC_WEBROOT / HC_GATEWAY_IP / HC_TENANTS_DIR / HC_ACME_EMAIL
# ============================================================
set -euo pipefail

TID="${1:?usage: enable-domain.sh <tenantId> <fqdn> <hostPort>}"
FQDN="${2:?fqdn required}"
PORT="${3:?hostPort required}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF_DIR="${HC_NGINX_CONF_DIR:-/opt/awareness/nginx/conf.d}"
CERTBOT_CONTAINER="${HC_CERTBOT_CONTAINER:-awareness-certbot}"
NGINX_CONTAINER="${HC_NGINX_CONTAINER:-awareness-nginx}"
WEBROOT="${HC_WEBROOT:-/var/www/certbot}"
GATEWAY_IP="${HC_GATEWAY_IP:-172.19.0.1}"
TENANT_ENV="${HC_TENANTS_DIR:-/srv/hypercode/tenants}/${TID}.env"
ACME_EMAIL="${HC_ACME_EMAIL:-e@awareness.market}"

[[ -f "${TENANT_ENV}" ]] || { echo "[x] 找不到租户 env: ${TENANT_ENV}" >&2; exit 1; }

echo "[1/4] 签发证书 ${FQDN}"
docker exec "${CERTBOT_CONTAINER}" certbot certonly --webroot -w "${WEBROOT}" \
  -d "${FQDN}" --non-interactive --agree-tos --email "${ACME_EMAIL}" --keep-until-expiring

echo "[2/4] 写入 nginx 配置并热加载"
cat > "${NGINX_CONF_DIR}/${FQDN}.conf" <<NGX
server {
    listen 80;
    server_name ${FQDN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${FQDN};

    ssl_certificate     /etc/letsencrypt/live/${FQDN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${FQDN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    client_max_body_size 50m;

    location / {
        proxy_pass http://${GATEWAY_IP}:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
NGX
docker exec "${NGINX_CONTAINER}" nginx -t
docker exec "${NGINX_CONTAINER}" nginx -s reload

echo "[3/4] 更新租户 env 并重建 server"
sed -i "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://${FQDN}|" "${TENANT_ENV}"
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://${FQDN},http://localhost:8081|" "${TENANT_ENV}"
grep -q '^HC_BIND_IP=' "${TENANT_ENV}" || echo "HC_BIND_IP=${GATEWAY_IP}" >> "${TENANT_ENV}"
cd "${HERE}"
docker compose -p "hc-${TID}" --env-file "${TENANT_ENV}" -f docker-compose.tenant.yml up -d --force-recreate server

echo "[4/4] 验证"
sleep 18
curl -s -o /dev/null -w "https://${FQDN} -> %{http_code}\n" --max-time 10 "https://${FQDN}/" || true
echo "完成。App 登录地址填：${FQDN}  密钥见 ${TENANT_ENV} 的 HYPERCODE_ACCESS_KEY"
