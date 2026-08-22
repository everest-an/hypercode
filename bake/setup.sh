#!/usr/bin/env bash
# HyperCode one-click installer (macOS/Linux) — beginner friendly wizard
set -u

HC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo
echo " =============================================="
echo "   HyperCode 一键安装向导"
echo "   最强大的 AI 编程软件与工作助手"
echo " =============================================="
echo

echo " [1/4] 安装程序到你的电脑..."
SHELL_RC="$HOME/.zshrc"
if [ -n "${BASH_VERSION:-}" ]; then SHELL_RC="$HOME/.bashrc"; fi
if ! grep -qF "$HC_DIR" "$SHELL_RC" 2>/dev/null; then
  echo "export PATH=\"$HC_DIR:\$PATH\"" >> "$SHELL_RC"
fi

echo " [2/4] 配置内置技能(228+ 领域技能,自动加载)..."
bash "$HC_DIR/bake/bake.sh" >/dev/null 2>&1 || true

echo " [3/4] 配置 AI 模型"
echo
echo "   HyperCode 需要你的 DeepSeek API key:"
echo "   1. 浏览器打开 https://platform.deepseek.com"
echo "   2. 免费注册,左侧 API keys 创建并复制"
echo "   3. 回到这里,粘贴 key 后按回车"
echo "   (key 只保存在你自己电脑上,不会上传)"
echo
printf "   粘贴你的 DeepSeek API key: "
read -r DSKEY

echo
echo " [4/4] 验证并保存..."
if ! curl -s -m 25 -o /dev/null -H "Authorization: Bearer $DSKEY" https://api.deepseek.com/models; then
  echo
  echo " [!] key 验证失败(网络问题或 key 不对)。请重新运行本向导。"
  exit 1
fi

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hypercode"
mkdir -p "$CONFIG_DIR"
sed "s|__HC_API_KEY__|$DSKEY|" "$HC_DIR/bake/templates/hypercode.json" > "$CONFIG_DIR/hypercode.json"

echo
echo " =============================================="
echo "   ✔ 安装完成!key 验证通过。"
echo " =============================================="
echo
echo "    打开【新的】终端窗口,输入:  hypercode"
echo "    就可以开始使用了。"
echo
