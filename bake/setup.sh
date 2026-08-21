#!/usr/bin/env bash
# HyperCode one-click installer (macOS/Linux) —— 骨架
# 生产版:安装器二进制(内置下载/校验/登录 UI)执行此流程。幂等。
set -euo pipefail

VERSION="${HYPERCODE_VERSION:-latest}"
BASE_URL="${HYPERCODE_CDN:-https://dl.awareliquid.ai/hypercode}"
INSTALL_DIR="${HYPERCODE_INSTALL_DIR:-$HOME/.hypercode/bin}"
BIN_PATH="$INSTALL_DIR/hypercode"

# ---- 1. 下载二进制(骨架:占位;生产版含校验和 + 原子替换 + 回滚) ----
mkdir -p "$INSTALL_DIR"
URL="$BASE_URL/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/$VERSION/hypercode"
echo "[setup] downloading $URL"
# 骨架阶段无真实 CDN,跳过实际下载;生产版在此执行下载/校验/原子替换

# ---- 2. PATH 注入(用户级,免 sudo) ----
SHELL_RC="$HOME/.zshrc"
if [ -n "${BASH_VERSION:-}" ]; then SHELL_RC="$HOME/.bashrc"; fi
if ! grep -qF "$INSTALL_DIR" "$SHELL_RC" 2>/dev/null; then
  echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$SHELL_RC"
  echo "[setup] added to PATH via $SHELL_RC"
fi

# ---- 3. 烘焙配置(幂等,受管块合并) ----
bash "$(dirname "$0")/bake.sh"

# ---- 4. 登录(生产版:浏览器登录 HyperCode Cloud) ----
echo "[setup] HyperCode installed. Run 'hypercode' to start; login via: hypercode auth"
echo "[setup] done."
