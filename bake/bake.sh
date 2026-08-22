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

# ---- 3. omo 配置:⚠️ 隔离原则 —— 绝不写共享的 ~/.omo/omo.jsonc ----
# 原因:该文件被所有 omo 宿主(OpenCode/Codex/Claude Code)共用,写入会弄坏用户的其他工具(2026-08-23 事故)。
# HyperCode 的 omo 品牌覆盖待"OMO_CONFIG_HOME 隔离补丁"实现(见 docs/OMO内置与升级兼容方案.md),当前跳过。
echo "[bake] omo shared config skipped (isolation rule: never touch ~/.omo/omo.jsonc)"

# ---- 3.5 内置技能(系统区整体替换;用户自建技能在 skills/ 其他目录,永不覆盖) ----
SKILLS_SRC="$(cd "$(dirname "$0")" && pwd)/skills"
if [ -d "$SKILLS_SRC" ]; then
  SKILLS_DEST="$CONFIG_DIR/skills"
  mkdir -p "$SKILLS_DEST"
  for NS_DIR in "$SKILLS_SRC"/*/; do
    NS_NAME="$(basename "$NS_DIR")"
    DST_DIR="$SKILLS_DEST/hypercode-$NS_NAME"
    rm -rf "$DST_DIR"
    cp -r "$NS_DIR" "$DST_DIR"
  done
  echo "[bake] skills installed: $SKILLS_DEST"
fi

# ---- 4. 插件安装(引擎自带插件管理器) ----
# 生产版:从 HyperCode CDN 下发插件包并本地安装(不走外网 npmjs)。
hypercode plugin install oh-my-openagent

echo "[bake] done. HyperCode is ready."
