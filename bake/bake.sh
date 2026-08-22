#!/usr/bin/env bash
# HyperCode bake script (macOS/Linux) —— 安装器核心逻辑规范
# 生产版:此逻辑内置进安装器二进制(编译后分发)。幂等,可重复执行。
set -euo pipefail

# ---- 1. 解析路径(与引擎 xdg-basedir 一致) ----
if [ -n "${HYPERCODE_CONFIG_DIR:-}" ]; then
  CONFIG_DIR="$HYPERCODE_CONFIG_DIR"
elif [ "$(uname -s)" = "Darwin" ]; then
  CONFIG_DIR="$HOME/Library/Preferences/hypercode"
else
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hypercode"
fi
OMO_DIR="$HOME/.omo"
TEMPLATES="$(cd "$(dirname "$0")" && pwd)/templates"

# ---- 2. 引擎配置:仅首次写入(升级永不覆盖用户修改) ----
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_DIR/hypercode.json" ]; then
  cp "$TEMPLATES/hypercode.json" "$CONFIG_DIR/hypercode.json"
  echo "[bake] wrote engine config: $CONFIG_DIR/hypercode.json"
else
  echo "[bake] engine config exists, skipping (user file preserved)"
fi

# ---- 3. omo 受管块:标记间替换(幂等;块外用户编辑原样保留) ----
mkdir -p "$OMO_DIR"
OMO_CFG="$OMO_DIR/omo.jsonc"
MANAGED="$(cat "$TEMPLATES/omo-managed.jsonc")"
BEGIN="// === HYPERCODE MANAGED BEGIN ==="
END="// === HYPERCODE MANAGED END ==="

if [ -f "$OMO_CFG" ]; then
  if grep -qF "$BEGIN" "$OMO_CFG" && grep -qF "$END" "$OMO_CFG"; then
    # 用 awk 替换 BEGIN..END 之间内容(含标记)
    awk -v begin="$BEGIN" -v end="$END" -v managed="$MANAGED" '
      BEGIN { printing = 1 }
      index($0, begin) { printf "%s\n", managed; printing = 0; next }
      index($0, end)   { printing = 1; next }
      printing { print }
    ' "$OMO_CFG" > "$OMO_CFG.tmp" && mv "$OMO_CFG.tmp" "$OMO_CFG"
    echo "[bake] managed block updated: $OMO_CFG"
  else
    # 标记缺失:追加到末尾
    printf '\n\n%s\n' "$MANAGED" >> "$OMO_CFG"
    echo "[bake] managed block appended: $OMO_CFG"
  fi
else
  printf '%s\n' "$MANAGED" > "$OMO_CFG"
  echo "[bake] wrote omo config: $OMO_CFG"
fi

# ---- 3.5 内置技能(系统区整体替换;用户自建技能在 skills/ 其他目录,永不覆盖) ----
SKILLS_SRC="$(cd "$(dirname "$0")" && pwd)/skills"
if [ -d "$SKILLS_SRC" ]; then
  SKILLS_DEST="$CONFIG_DIR/skills"
  mkdir -p "$SKILLS_DEST"
  for NS in hypercode-academic hypercode-finance; do
    SRC_DIR="$SKILLS_SRC/${NS#hypercode-}"
    if [ -d "$SRC_DIR" ]; then
      DST_DIR="$SKILLS_DEST/$NS"
      rm -rf "$DST_DIR"
      cp -r "$SRC_DIR" "$DST_DIR"
    fi
  done
  echo "[bake] skills installed: $SKILLS_DEST"
fi

# ---- 4. 插件安装(引擎自带插件管理器) ----
# 生产版:从 HyperCode CDN 下发插件包并本地安装(不走外网 npmjs)。
hypercode plugin install oh-my-openagent

echo "[bake] done. HyperCode is ready."
