// 本地 MCP 服务器若声明为本 CLI 自身（例如 `hypercode x <包>`），就可以跑在编译进二进制的运行时上，
// 从而不需要客户机额外安装 Node：BUN_BE_BUN 会让编译后的 Bun 二进制表现为 Bun 运行时本身。
//
// 同时接受 opencode 与 hypercode 两个名字，原因有三：
//   1. 本仓是 opencode 的 fork，二进制已改名为 hypercode；
//   2. 合并 upstream 时，对方那行 `cmd === "opencode"` 会回来；
//   3. 用户的配置可能在另一平台上写过。
// 因此无论改名朝哪个方向做，这个判断都不会失效。
//
// 保持导出：单元测试是防止 upstream 合并静默丢掉该行为的守门人。
const SELF_COMMAND_NAMES = new Set(["opencode", "hypercode"])

/**
 * `command` 是否指向本 CLI 自身。忽略目录、扩展名与大小写，
 * 且同时兼容 `/` 与 `\` 分隔符，因此 macOS / Linux / Windows 行为一致。
 */
export function isSelfCommand(command: string) {
  const executable = command.split(/[\\/]/).at(-1) ?? command
  return SELF_COMMAND_NAMES.has(executable.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase())
}
