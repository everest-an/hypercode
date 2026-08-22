# HyperCode bake script (Windows) —— 安装器核心逻辑规范
# 生产版:此逻辑内置进安装器二进制(编译后分发)。
# 本脚本为开发工具 + 逻辑规范,幂等,可重复执行。
$ErrorActionPreference = "Stop"

# ---- 1. 解析路径(与引擎 xdg-basedir 一致) ----
$configDir = if ($env:HYPERCODE_CONFIG_DIR) { $env:HYPERCODE_CONFIG_DIR } else { Join-Path $env:APPDATA "hypercode" }
$omoDir = Join-Path $HOME ".omo"
$templates = Join-Path $PSScriptRoot "templates"

# ---- 2. 引擎配置:仅首次写入(升级永不覆盖用户修改) ----
$engineCfg = Join-Path $configDir "hypercode.json"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if (-not (Test-Path -LiteralPath $engineCfg)) {
    Copy-Item -LiteralPath (Join-Path $templates "hypercode.json") -Destination $engineCfg
    Write-Output "[bake] wrote engine config: $engineCfg"
} else {
    Write-Output "[bake] engine config exists, skipping (user file preserved)"
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
& hypercode plugin install oh-my-openagent
if ($LASTEXITCODE -ne 0) { Write-Warning "[bake] plugin install failed (exit $LASTEXITCODE)"; exit 1 }

Write-Output "[bake] done. HyperCode is ready."
