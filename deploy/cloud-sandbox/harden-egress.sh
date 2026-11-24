#!/usr/bin/env bash
# ============================================================
# harden-egress.sh —— 封住沙箱的出站"私网"访问（在宿主机执行，需 root）
#   允许：同网络(网关↔沙箱)互通 + 公网出口(模型 API 等)
#   拦截：沙箱 → 私网段 / 元数据地址 / CGNAT
# 说明：这是 P0 的"够用版"；正式版建议换成"出站代理 + 域名白名单"。
# ============================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "需要 root（sudo $0）" >&2
  exit 1
fi

NET="${HC_NETWORK:-hc-sandbox}"
SUBNET="$(docker network inspect "${NET}" --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' 2>/dev/null | awk '{print $1}')"
if [[ -z "${SUBNET}" ]]; then
  echo "找不到网络 ${NET} 的子网，先运行 launch-workspace.sh 创建网络" >&2
  exit 1
fi
echo "network=${NET}  subnet=${SUBNET}"

insert_once() {
  # 幂等：不存在才插到链首
  if ! iptables -C DOCKER-USER "$@" 2>/dev/null; then
    iptables -I DOCKER-USER 1 "$@"
  fi
}

# 1) 先插 DROP(依次被顶到上面)
for cidr in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  insert_once -s "${SUBNET}" -d "${cidr}" -j DROP
done

# 2) 同网络互通放最前(网关 → 沙箱)
insert_once -s "${SUBNET}" -d "${SUBNET}" -j ACCEPT

echo ""
echo "=== DOCKER-USER 前 12 条 ==="
iptables -L DOCKER-USER -n --line-numbers | head -n 14

cat <<'EOF'

提示：
- 规则重启会丢，请用 iptables-persistent 或 systemd 在开机时重跑本脚本。
- 千万不要把 awareness-box / 其他业务容器接入 hc-sandbox 网络。
EOF
