#!/usr/bin/env bash
# HyperCode one-click installer (macOS/Linux) — beginner friendly wizard
set -euo pipefail

HC_DIR="$(cd "$(dirname "$0")" && pwd)"
HC_LOG="${TMPDIR:-/tmp}/hypercode-setup.log"

# ---- 兼容两种发行布局:bake.sh 与 setup.sh 同级,或在 bake/ 子目录下 ----
if [ -f "$HC_DIR/bake/bake.sh" ]; then
  HC_BAKE="$HC_DIR/bake/bake.sh"
elif [ -f "$HC_DIR/bake.sh" ]; then
  HC_BAKE="$HC_DIR/bake.sh"
else
  echo " [!] 安装包不完整:找不到 bake.sh。请重新下载完整安装包。" >&2
  exit 1
fi

echo
echo " =============================================="
echo "   HyperCode 一键安装向导"
echo "   最强大的 AI 编程软件与工作助手"
echo " =============================================="
echo

echo " [1/4] 安装程序到你的电脑..."
# 必须看用户的【登录 shell】,不是跑这个脚本的 shell。
# README 让用户用 `bash setup.sh` 运行,所以 BASH_VERSION 永远是有值的 ——
# 用它判断会在 macOS 上把 PATH 写进 .bashrc,而 macOS 默认登录 shell 是 zsh,
# 交互式 zsh 从不读 .bashrc,用户新开终端永远 command not found。
PATH_LINE="export PATH=\"$HC_DIR:\$PATH\"  # HyperCode"
LOGIN_SHELL="$(basename "${SHELL:-/bin/bash}")"
UNAME_S="$(uname -s)"

RC_FILES=()
case "$LOGIN_SHELL" in
  zsh)  RC_FILES+=("$HOME/.zshrc") ;;
  bash)
    if [ "$UNAME_S" = "Darwin" ]; then
      # macOS 的 Terminal 每个窗口都是 login shell,只读 .bash_profile
      RC_FILES+=("$HOME/.bash_profile")
    else
      RC_FILES+=("$HOME/.bashrc")
    fi
    ;;
  *) RC_FILES+=("$HOME/.profile") ;;
esac
# 稳妥起见:已经存在的其它 rc 文件也一并写入(用户可能会换 shell)
for EXTRA in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  if [ -f "$EXTRA" ]; then
    SEEN=0
    for RC in "${RC_FILES[@]}"; do
      if [ "$RC" = "$EXTRA" ]; then SEEN=1; fi
    done
    if [ "$SEEN" = "0" ]; then RC_FILES+=("$EXTRA"); fi
  fi
done

for RC in "${RC_FILES[@]}"; do
  if [ -f "$RC" ] && grep -qF "$PATH_LINE" "$RC"; then
    continue
  fi
  printf '\n%s\n' "$PATH_LINE" >> "$RC"
  echo "   PATH 已写入: $RC"
done
# 只改本进程 PATH,好让下一步能找到 hypercode
export PATH="$HC_DIR:$PATH"

echo " [2/4] 配置内置技能(228+ 领域技能,自动加载)..."
# 失败必须让用户看见:以前这里是 `>/dev/null 2>&1 || true`,
# 229 个技能一个没装成也照样显示成功。
if ! bash "$HC_BAKE" >"$HC_LOG" 2>&1; then
  echo >&2
  echo " [!] 内置技能安装失败,安装已中止。" >&2
  echo "     详细日志: $HC_LOG" >&2
  tail -n 20 "$HC_LOG" >&2 || true
  exit 1
fi

echo " [3/4] 配置 AI 模型"
echo
echo "   HyperCode 需要你的 DeepSeek API key:"
echo "   1. 浏览器打开 https://platform.deepseek.com"
echo "   2. 免费注册,左侧 API keys 创建并复制"
echo "   3. 回到这里,粘贴 key 后按回车"
echo "   (key 只保存在你自己电脑上,不会上传)"
echo
printf "   粘贴你的 DeepSeek API key (输入不显示,粘贴后直接回车): "
DSKEY=""
if ! IFS= read -rs DSKEY; then DSKEY=""; fi
echo

echo
echo " [4/4] 验证并保存..."
# 去掉粘贴时常见的首尾空白/换行(DeepSeek key 本身不含空白字符)
DSKEY="$(printf '%s' "$DSKEY" | tr -d '[:space:]')"
if [ -z "$DSKEY" ]; then
  echo " [!] 你没有输入 key(直接按了回车)。请重新运行本向导。" >&2
  exit 1
fi
case "$DSKEY" in
  sk-*) ;;
  *)
    echo " [!] key 格式不对:DeepSeek 的 key 以 sk- 开头。" >&2
    echo "     请回到 https://platform.deepseek.com 重新复制完整的 key。" >&2
    exit 1
    ;;
esac

# 必须断言 HTTP 状态码:curl 不带 -f 时,401 的退出码也是 0,
# 于是废 key / 空 key 都会被当成"验证通过"写进配置。
# key 通过 stdin 的 curl config 传入,不出现在 argv 里(ps 看不到)。
HTTP_CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$DSKEY" \
  | curl -s -m 25 -o /dev/null -w '%{http_code}' --config - https://api.deepseek.com/models || true)"
if [ "$HTTP_CODE" != "200" ]; then
  echo >&2
  if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    echo " [!] key 验证失败:DeepSeek 拒绝了这个 key(HTTP $HTTP_CODE)。" >&2
    echo "     请检查 key 是否复制完整、账户是否欠费。" >&2
  else
    echo " [!] key 验证失败:连不上 DeepSeek(HTTP $HTTP_CODE)。" >&2
    echo "     请检查网络后重新运行本向导。" >&2
  fi
  exit 1
fi

# 写配置交给 bake.sh --config-only:它做字段级 apiKey 更新 + 原子替换,
# 已有配置里用户自己加的 provider/model/plugin 全部保留。
if ! HC_API_KEY="$DSKEY" bash "$HC_BAKE" --config-only >>"$HC_LOG" 2>&1; then
  echo >&2
  echo " [!] 写入配置文件失败。详细日志: $HC_LOG" >&2
  tail -n 20 "$HC_LOG" >&2 || true
  exit 1
fi
unset DSKEY

CONFIG_DIR="${OPENCODE_CONFIG_DIR:-${HYPERCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/hypercode}}"

echo
echo " =============================================="
echo "   ✔ 安装完成!key 验证通过。"
echo " =============================================="
echo
echo "    配置文件: $CONFIG_DIR/hypercode.json"
echo
echo "    打开【新的】终端窗口,输入:  hypercode"
echo "    就可以开始使用了。"
echo
