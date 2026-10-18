#!/usr/bin/env bash
# HyperCode 一键连接 —— 安装向导用的设备码配对客户端。
#
# 产品要求: 用户在本站注册/付费, 永远不需要看到或复制 API Key。这里打开授权页, 等用户点一次
# "授权", 然后把服务端发回来的 key 交给调用方写入配置。
#
# 契约:
#   成功  → stdout 只有一行: API Key; 进度全部走 stderr; exit 0
#   失败  → stdout 为空; 原因在 stderr; exit 非 0(调用方回退到手动粘贴)
#
# 环境变量:
#   HYPERCODE_API       后端接口根地址(默认 https://api.trust3.pro); 预发/测试可覆盖
#   HYPERCODE_NO_BROWSER=1  不尝试打开浏览器(SSH/无桌面环境), 只打印链接
#
# 注意两个域名分工: 接口在 api.trust3.pro(静态站点对 POST /api/v1/* 返回 405),
# 授权页在 www.trust3.pro —— 页面地址由服务端返回的 verification_uri 决定, 这里不用猜。
set -uo pipefail

API="${HYPERCODE_API:-https://api.trust3.pro}"

note() { printf '%s\n' "$*" >&2; }

# 只解析已知的扁平响应; 站点返回的是 Go 的紧凑 JSON, 每个键只出现一次。
json_str() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1; }
json_num() { printf '%s' "$1" | sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -n 1; }

open_browser() {
  [ "${HYPERCODE_NO_BROWSER:-}" = "1" ] && return 1
  if command -v open >/dev/null 2>&1 && open "$1" >/dev/null 2>&1; then return 0; fi
  if command -v xdg-open >/dev/null 2>&1 && xdg-open "$1" >/dev/null 2>&1; then return 0; fi
  return 1
}

response="$(curl -sS -m 25 -X POST "$API/api/v1/hypercode/device/code" \
  -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)"
device_code="$(json_str "$response" device_code)"
user_code="$(json_str "$response" user_code)"
verify_uri="$(json_str "$response" verification_uri)"
interval="$(json_num "$response" interval)"
expires_in="$(json_num "$response" expires_in)"
[ -n "$interval" ] || interval=5
[ -n "$expires_in" ] || expires_in=600

if [ -z "$device_code" ] || [ -z "$user_code" ]; then
  note "  [!] 连接服务没有响应(站点不可达,或该功能尚未开放)。"
  exit 1
fi

note ""
note "   配对码: $user_code"
note "   请在浏览器里登录,然后点一下「授权此设备」。"
if ! open_browser "$verify_uri"; then
  note "   (没能自动打开浏览器,请手动访问: $verify_uri)"
fi
note ""

# 每 interval 秒问一次; 到 expires_in 就放弃, 不把用户留在等待里。
deadline=$(( $(date +%s) + expires_in ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  sleep "$interval"
  poll="$(curl -sS -m 25 -X POST "$API/api/v1/hypercode/device/token" \
    -H 'Content-Type: application/json' -d "{\"device_code\":\"$device_code\"}" 2>/dev/null || true)"
  case "$(json_str "$poll" status)" in
    approved)
      key="$(json_str "$poll" api_key)"
      if [ -n "$key" ]; then
        printf '%s\n' "$key"
        exit 0
      fi
      note "  [!] 授权成功,但没有收到密钥。"
      exit 1
      ;;
    expired)
      note "  [!] 配对码已过期,请重新连接。"
      exit 1
      ;;
  esac
done

note "  [!] 等待授权超时。"
exit 1
