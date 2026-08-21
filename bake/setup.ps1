# HyperCode one-click installer (Windows) —— 骨架
# 生产版:安装器二进制(内置下载/校验/登录 UI)执行此流程。
# 本脚本为开发骨架:下载二进制 → 安装到用户目录 → 写入 PATH → 烘焙配置。
$ErrorActionPreference = "Stop"

# ---- 发布参数(生产版由构建注入;骨架用环境变量占位) ----
$Version = if ($env:HYPERCODE_VERSION) { $env:HYPERCODE_VERSION } else { "latest" }
$BaseUrl = if ($env:HYPERCODE_CDN) { $env:HYPERCODE_CDN } else { "https://dl.awareliquid.ai/hypercode" }
$InstallDir = Join-Path $env:LOCALAPPDATA "HyperCode"
$BinPath = Join-Path $InstallDir "hypercode.exe"

# ---- 1. 下载二进制(骨架:占位;生产版含校验和 + 原子替换 + 回滚) ----
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Url = "$BaseUrl/windows-x64/$Version/hypercode.exe"
Write-Output "[setup] downloading $Url"
# 骨架阶段无真实 CDN,跳过实际下载;生产版在此执行:
# Invoke-WebRequest -Uri $Url -OutFile "$BinPath.download" ; 校验哈希 ; Move-Item 原子替换

# ---- 2. PATH 注入(用户级,免管理员) ----
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
    Write-Output "[setup] added to user PATH: $InstallDir"
} else {
    Write-Output "[setup] PATH already contains $InstallDir"
}

# ---- 3. 烘焙配置(幂等,受管块合并) ----
& (Join-Path $PSScriptRoot "bake.ps1")
if ($LASTEXITCODE -ne 0) { Write-Warning "[setup] bake failed"; exit 1 }

# ---- 4. 登录(生产版:打开浏览器到 HyperCode Cloud 完成微信登录+授权) ----
Write-Output "[setup] HyperCode installed. Run 'hypercode' to start; login via: hypercode auth"

Write-Output "[setup] done."
