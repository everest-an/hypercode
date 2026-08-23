#!/usr/bin/env bash
# HyperCode bake script (macOS/Linux) —— 安装器核心逻辑规范
# 生产版:此逻辑内置进安装器二进制(编译后分发)。幂等,可重复执行。
set -euo pipefail

# ---- 0. 参数 ----
# --config-only : 只处理配置(跳过技能与插件安装),供安装向导第 4 步复用。
# API key 从环境变量 HC_API_KEY 读,不走命令行参数(命令行会出现在 ps 里)。
CONFIG_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --config-only) CONFIG_ONLY=1 ;;
    *) echo "[bake] unknown argument: $arg" >&2; exit 2 ;;
  esac
done
API_KEY="${HC_API_KEY:-}"

# ---- 1. 解析路径(必须与引擎 packages/core/src/global.ts 完全一致) ----
# 引擎: config = path.join(xdgConfig, "hypercode"),覆盖变量是 OPENCODE_CONFIG_DIR。
# xdg-basedir@5 的 xdgConfig = XDG_CONFIG_HOME || ~/.config —— 没有任何平台分支,
# 所以 macOS 上引擎读的也是 ~/.config/hypercode,不是 ~/Library/Preferences。
if [ -n "${OPENCODE_CONFIG_DIR:-}" ]; then
  CONFIG_DIR="$OPENCODE_CONFIG_DIR"
elif [ -n "${HYPERCODE_CONFIG_DIR:-}" ]; then
  # 兼容旧文档里的变量名;引擎本身只认 OPENCODE_CONFIG_DIR。
  CONFIG_DIR="$HYPERCODE_CONFIG_DIR"
else
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hypercode"
fi
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATES="$SELF_DIR/templates"
ENGINE_CFG="$CONFIG_DIR/hypercode.json"

# ---- 2. 引擎配置:仅首次写入(升级永不覆盖用户修改) ----
mkdir -p "$CONFIG_DIR"
if [ ! -f "$ENGINE_CFG" ]; then
  if [ ! -f "$TEMPLATES/hypercode.json" ]; then
    echo "[bake] template not found: $TEMPLATES/hypercode.json" >&2
    exit 1
  fi
  # 先写临时文件再 mv,避免任何中途失败留下 0 字节配置
  cp "$TEMPLATES/hypercode.json" "$ENGINE_CFG.tmp.$$"
  mv "$ENGINE_CFG.tmp.$$" "$ENGINE_CFG"
  echo "[bake] wrote engine config: $ENGINE_CFG"
else
  echo "[bake] engine config exists, keeping user edits: $ENGINE_CFG"
fi

# ---- 2.5 API key:字段级更新,绝不整文件覆盖 ----
# 用户自己加的 provider / model / plugin / mcp 配置必须原样保留,
# 所以只替换第一处 "apiKey": "..." 的值,其余字节不动。
# key 通过 ENVIRON 传给 awk,不出现在 argv 里。
if [ -n "$API_KEY" ]; then
  if ! grep -q '"apiKey"' "$ENGINE_CFG"; then
    echo "[bake] no apiKey field found in $ENGINE_CFG - add it manually" >&2
    exit 1
  fi
  HC_API_KEY="$API_KEY" awk '
    BEGIN { k = ENVIRON["HC_API_KEY"]; patched = 0 }
    patched == 0 && match($0, /"apiKey"[ \t]*:[ \t]*"[^"]*"/) {
      print substr($0, 1, RSTART - 1) "\"apiKey\": \"" k "\"" substr($0, RSTART + RLENGTH)
      patched = 1
      next
    }
    { print }
  ' "$ENGINE_CFG" > "$ENGINE_CFG.tmp.$$"
  mv "$ENGINE_CFG.tmp.$$" "$ENGINE_CFG"
  echo "[bake] api key updated in: $ENGINE_CFG"
fi

if [ "$CONFIG_ONLY" = "1" ]; then
  echo "[bake] config-only mode: skills and plugins skipped."
  exit 0
fi

# ---- 3. omo 配置:⚠️ 隔离原则 —— 绝不写共享的 ~/.omo/omo.jsonc ----
# 原因:该文件被所有 omo 宿主(OpenCode/Codex/Claude Code)共用,写入会弄坏用户的其他工具(2026-08-23 事故)。
# HyperCode 的 omo 品牌覆盖待"OMO_CONFIG_HOME 隔离补丁"实现(见 docs/OMO内置与升级兼容方案.md),当前跳过。
echo "[bake] omo shared config skipped (isolation rule: never touch ~/.omo/omo.jsonc)"

# ---- 3.5 内置技能(系统区整体替换;用户自建技能在 skills/ 其他目录,永不覆盖) ----
SKILLS_SRC="$SELF_DIR/skills"
if [ -d "$SKILLS_SRC" ]; then
  SKILLS_DEST="$CONFIG_DIR/skills"
  mkdir -p "$SKILLS_DEST"
  for NS_DIR in "$SKILLS_SRC"/*/; do
    [ -d "$NS_DIR" ] || continue
    NS_NAME="$(basename "$NS_DIR")"
    DST_DIR="$SKILLS_DEST/hypercode-$NS_NAME"
    rm -rf "$DST_DIR"
    cp -r "$NS_DIR" "$DST_DIR"
  done
  echo "[bake] skills installed: $SKILLS_DEST"
fi

# ---- 4. 插件安装(引擎自带插件管理器) ----
# 生产版:从 HyperCode CDN 下发插件包并本地安装(不走外网 npmjs)。
if command -v hypercode >/dev/null 2>&1; then
  hypercode plugin install oh-my-openagent
else
  # 首次安装时 PATH 还没生效属正常情况,不能当致命错误(否则整个向导会挂)。
  echo "[bake] 'hypercode' not on PATH yet - plugin install skipped. Reopen your terminal and run: hypercode plugin install oh-my-openagent" >&2
fi

echo "[bake] done. HyperCode is ready."
