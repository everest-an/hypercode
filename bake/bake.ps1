# HyperCode bake script (Windows) —— 安装器核心逻辑规范
# 生产版:此逻辑内置进安装器二进制(编译后分发)。
# 本脚本为开发工具 + 逻辑规范,幂等,可重复执行。
param(
    # DeepSeek API key。优先取参数,其次取环境变量 HC_API_KEY。
    # 安装向导用环境变量传,避免 key 出现在命令行里被其他进程读走。
    [string]$ApiKey = "",
    # 只处理配置(跳过技能与插件安装),供安装向导第 4 步复用。
    [switch]$ConfigOnly
)
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($ApiKey)) { $ApiKey = $env:HC_API_KEY }
if ($null -eq $ApiKey) { $ApiKey = "" }
$ApiKey = $ApiKey.Trim()

# ---- 1. 解析路径(必须与引擎 packages/core/src/global.ts 完全一致) ----
# 引擎: config = path.join(xdgConfig, "hypercode"),覆盖变量是 OPENCODE_CONFIG_DIR。
# xdg-basedir@5 的 xdgConfig = XDG_CONFIG_HOME || ~/.config —— 没有任何平台分支,
# 所以 Windows 上引擎读的是 %USERPROFILE%\.config\hypercode。
# ⚠️ 绝不能写 %APPDATA%\hypercode:引擎永远不读那里,写进去等于配置没生效。
$hcHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
if ($env:OPENCODE_CONFIG_DIR) {
    $configDir = $env:OPENCODE_CONFIG_DIR
} elseif ($env:HYPERCODE_CONFIG_DIR) {
    # 兼容旧文档里的变量名;引擎本身只认 OPENCODE_CONFIG_DIR。
    $configDir = $env:HYPERCODE_CONFIG_DIR
} elseif ($env:XDG_CONFIG_HOME) {
    $configDir = Join-Path $env:XDG_CONFIG_HOME "hypercode"
} else {
    $configDir = Join-Path (Join-Path $hcHome ".config") "hypercode"
}
$templates = Join-Path $PSScriptRoot "templates"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# 先写临时文件再原子替换:任何中途失败都不会留下 0 字节的半截配置。
function Write-TextAtomic {
    param([string]$Path, [string]$Text)
    $tmp = "$Path.tmp$PID"
    [System.IO.File]::WriteAllText($tmp, $Text, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

# ---- 2. 引擎配置:仅首次写入(升级永不覆盖用户修改) ----
$engineCfg = Join-Path $configDir "hypercode.json"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if (-not (Test-Path -LiteralPath $engineCfg)) {
    $tplPath = Join-Path $templates "hypercode.json"
    if (-not (Test-Path -LiteralPath $tplPath)) {
        Write-Warning "[bake] template not found: $tplPath"
        exit 1
    }
    Write-TextAtomic -Path $engineCfg -Text ([System.IO.File]::ReadAllText($tplPath, [System.Text.Encoding]::UTF8))
    Write-Output "[bake] wrote engine config: $engineCfg"
} else {
    Write-Output "[bake] engine config exists, keeping user edits: $engineCfg"
}

# ---- 2.5 API key:字段级更新,绝不整文件覆盖 ----
# 用户自己加的 provider / model / plugin / mcp 配置必须原样保留,
# 所以只替换第一处 "apiKey": "..." 的值,其余字节不动。
if ($ApiKey.Length -gt 0) {
    $content = [System.IO.File]::ReadAllText($engineCfg, [System.Text.Encoding]::UTF8)
    $rx = New-Object System.Text.RegularExpressions.Regex('"apiKey"\s*:\s*"[^"]*"')
    if (-not $rx.IsMatch($content)) {
        Write-Warning "[bake] no apiKey field found in $engineCfg - add it manually"
        exit 1
    }
    # $ 在 .NET 替换串里是特殊字符,必须转义成 $$
    $replacement = '"apiKey": "' + ($ApiKey -replace '\$', '$$$$') + '"'
    Write-TextAtomic -Path $engineCfg -Text ($rx.Replace($content, $replacement, 1))
    Write-Output "[bake] api key updated in: $engineCfg"
}

if ($ConfigOnly) {
    Write-Output "[bake] config-only mode: skills and plugins skipped."
    exit 0
}

# ---- 3. omo 配置:⚠️ 隔离原则 —— 绝不写共享的 ~/.omo/omo.jsonc ----
# 原因:该文件被所有 omo 宿主(OpenCode/Codex/Claude Code)共用,写入会弄坏用户的其他工具(2026-08-23 事故)。
# HyperCode 的 omo 品牌覆盖待"OMO_CONFIG_HOME 隔离补丁"实现(见 docs/OMO内置与升级兼容方案.md),当前跳过。
Write-Output "[bake] omo shared config skipped (isolation rule: never touch ~/.omo/omo.jsonc)"

# ---- 3.5 内置技能(系统区整体替换;用户自建技能在 skills/ 其他目录,永不覆盖) ----
$skillsSrc = Join-Path $PSScriptRoot "skills"
if (Test-Path -LiteralPath $skillsSrc) {
    $skillsDest = Join-Path $configDir "skills"
    New-Item -ItemType Directory -Force -Path $skillsDest | Out-Null
    Get-ChildItem -LiteralPath $skillsSrc -Directory | ForEach-Object {
        $dstDir = Join-Path $skillsDest ("hypercode-" + $_.Name)
        if (Test-Path -LiteralPath $dstDir) { Remove-Item -LiteralPath $dstDir -Recurse -Force }
        Copy-Item -LiteralPath $_.FullName -Destination $dstDir -Recurse -Force
    }
    Write-Output "[bake] skills installed: $skillsDest"
}

# ---- 4. 插件安装(引擎自带插件管理器) ----
# 生产版:从 HyperCode CDN 下发插件包并本地安装(不走外网 npmjs)。
if ($null -eq (Get-Command hypercode -ErrorAction SilentlyContinue)) {
    # 首次安装时 PATH 还没生效属正常情况,不能当致命错误(否则整个向导会挂)。
    Write-Warning "[bake] 'hypercode' not on PATH yet - plugin install skipped. Reopen your terminal and run: hypercode plugin install oh-my-openagent"
} else {
    & hypercode plugin install oh-my-openagent
    if ($LASTEXITCODE -ne 0) { Write-Warning "[bake] plugin install failed (exit $LASTEXITCODE)"; exit 1 }
}

Write-Output "[bake] done. HyperCode is ready."
