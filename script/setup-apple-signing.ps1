<#
.SYNOPSIS
  把 macOS 签名 / 公证所需的 5 个 GitHub Secrets 一次性写进发布仓库。

.DESCRIPTION
  签名用 **Developer ID Application 证书**(.p12 + 导出密码), 公证用 **app 专用密码**。
  这里**不需要也不接受** Apple ID 的登录密码: Apple 的公证工具链本身就设计成用 app 专用密码
  或 App Store Connect API Key, 主密码不该出现在任何构建机器或脚本文本里。

  脚本做四件事:
    1. 打开 .p12, 断言它确实是 "Developer ID Application" 证书(而不是 Apple Development /
       Mac App Distribution —— 后者用于上架 App Store, 不能用于自行分发的 .dmg), 并核对 Team ID
    2. base64 编码后写入 MAC_CERT_P12_BASE64
    3. 写入 MAC_CERT_PASSWORD / APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
    4. 回读 gh secret list 确认, 并打印下一条要跑的命令

  所有值都经 stdin 交给 gh, 不进命令行参数(进程列表可见); 不落任何临时文件。

.EXAMPLE
  pwsh -File script/setup-apple-signing.ps1 `
    -P12 ~/Desktop/hypercode-signing.p12 `
    -P12Password '导出时设的密码' `
    -AppleId anmuning@awareliquid.ai `
    -TeamId ABCDE12345 `
    -AppPassword 'abcd-efgh-ijkl-mnop'

.EXAMPLE
  # 先干跑, 确认证书类型/Team ID 都对, 再正式写入
  pwsh -File script/setup-apple-signing.ps1 -P12 ... -P12Password ... -AppleId ... -TeamId ... -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$P12,
  [Parameter(Mandatory = $true)][string]$P12Password,
  [Parameter(Mandatory = $true)][string]$AppleId,
  [Parameter(Mandatory = $true)][string]$TeamId,
  [string]$AppPassword,
  [string]$Repo = "everest-an/hypercode",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
# 5 个值都是 ASCII; 显式设 UTF8 只是不让 PS 5.1 的默认编码在管道里动它们。
$OutputEncoding = [System.Text.Encoding]::UTF8

function Info($m) { Write-Host "  $m" }
function Good($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red }

Write-Host "`nHyperCode macOS 签名配置" -ForegroundColor Cyan
Write-Host "  仓库: $Repo`n"

# ---- 0. 依赖 ----
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Bad "找不到 gh (GitHub CLI)。安装: winget install GitHub.cli"
  exit 1
}
$auth = gh auth status 2>&1 | Out-String
if ($auth -notmatch "Logged in") { Bad "gh 未登录。先跑: gh auth login"; exit 1 }

if (-not (Test-Path -LiteralPath $P12)) { Bad "找不到 .p12: $P12"; exit 1 }
$resolved = (Resolve-Path -LiteralPath $P12).Path
Info "证书文件: $resolved"

# ---- 1. 断言证书类型 ----
# 优先用 openssl(它同时给出 friendlyName 与 subject), 没有就用 .NET 读证书主题。
function Get-CertIdentityFromOpenssl([string]$path, [string]$password) {
  # 密码经环境变量交给 openssl, 不进 argv(进程列表能看到命令行参数)。
  $env:HC_P12_PW = $password
  try {
    $out = & openssl pkcs12 -in $path -nokeys -passin env:HC_P12_PW 2>&1 | Out-String
    if ($out -match "Mac verify error|invalid password") {
      # 老式 p12(3DES/RC2)在 OpenSSL 3 下需要 -legacy。
      $out = & openssl pkcs12 -in $path -nokeys -legacy -passin env:HC_P12_PW 2>&1 | Out-String
    }
    return $out
  } finally {
    Remove-Item Env:HC_P12_PW -ErrorAction SilentlyContinue
  }
}

function Get-CertIdentityFromDotnet([string]$path, [string]$password) {
  # 用 Import(fileName, password, flags) 而不是构造函数: New-Object 的构造函数重载解析会把
  # 文件路径绑到别的重载上, 报出与真实原因无关的 "cannot find the file specified"。
  #
  # EphemeralKeySet 只有 .NET Core 支持; Windows PowerShell 5.1 跑在 .NET Framework 上, 只能退回
  # DefaultKeySet —— 那条路会把证书私钥写进当前用户的证书存储(一次性设置动作, 事后可在
  # certmgr.msc 的"个人"里删掉)。所以优先用 openssl: 它完全不碰证书存储。
  $flagsType = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]
  $candidates = @()
  try { $candidates += $flagsType::EphemeralKeySet } catch {}
  $candidates += $flagsType::DefaultKeySet

  $lastError = $null
  foreach ($flags in $candidates) {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
    try {
      $cert.Import($path, $password, $flags)
      return "subject=$($cert.Subject) | friendlyName=$($cert.FriendlyName)"
    } catch {
      $lastError = $_
    } finally {
      $cert.Dispose()
    }
  }
  throw $lastError
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
$identity = ""
$usedTool = ""
if ($openssl) {
  $dump = Get-CertIdentityFromOpenssl $resolved $P12Password
  if ($dump -match "Mac verify error|invalid password") {
    Bad "打不开这个 .p12 —— 导出密码可能不对。"
    exit 1
  }
  $identity = ($dump -split "`n" | Where-Object { $_ -match "friendlyName:|subject=" } | ForEach-Object { $_.Trim() }) -join " | "
  $usedTool = "openssl"
} else {
  Info "[warn] PATH 里没有 openssl(装了 Git for Windows 就有), 改用 .NET 读取证书"
  try {
    $identity = Get-CertIdentityFromDotnet $resolved $P12Password
  } catch {
    Bad "打不开这个 .p12: $($_.Exception.Message)"
    Info "多数情况是导出密码不对; 也可能是文件损坏。"
    exit 1
  }
  $usedTool = ".NET"
}
Good "已读取证书($usedTool)"

if ($identity -notmatch "Developer ID Application") {
  Bad "这个 .p12 里没有 'Developer ID Application' 证书。"
  Info "实际内容: $identity"
  Info "自行分发(.dmg 从官网/GitHub 下载)必须用 Developer ID Application;"
  Info "'Apple Development' 只能本机调试, 'Mac App Distribution' 只能上架 App Store。"
  Info "在存放证书的 Mac 上用这条命令确认: security find-identity -v -p codesigning"
  exit 1
}
Good "证书类型正确: Developer ID Application"

if ($identity -notmatch [regex]::Escape($TeamId)) {
  Bad "Team ID 对不上: 参数给的是 $TeamId"
  Info "证书里的标识: $identity"
  Info "Team ID 在 developer.apple.com → Membership 页可以查到(形如 ABCDE12345)。"
  exit 1
}
Good "Team ID 匹配: $TeamId"

# ---- 2. 干跑: 只验证证书与 Team ID, 不要 app 专用密码 ----
$secretNames = @(
  "MAC_CERT_P12_BASE64",
  "MAC_CERT_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID"
)
if ($DryRun) {
  Write-Host "`n[DryRun] 校验通过。正式写入时会在这 5 个 secret 上写入 $Repo (值不回显):" -ForegroundColor Yellow
  foreach ($name in $secretNames) {
    if ($name -eq "MAC_CERT_P12_BASE64") {
      $size = (Get-Item -LiteralPath $resolved).Length
      Info "$name  (证书 $size 字节 → base64)"
    } else {
      Info "$name"
    }
  }
  Write-Host "`n干跑结束, 未做任何修改。去掉 -DryRun 即真正写入(届时会要 app 专用密码)。`n"
  exit 0
}

# ---- 3. 公证用的 app 专用密码 ----
if (-not $AppPassword) {
  Info "需要 app 专用密码(不是 Apple ID 登录密码): https://appleid.apple.com → 登录与安全 → App 专用密码"
  $secure = Read-Host "  粘贴 app 专用密码" -AsSecureString
  $AppPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ([string]::IsNullOrWhiteSpace($AppPassword)) { Bad "app 专用密码为空"; exit 1 }
if ($AppPassword -notmatch "^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$") {
  Info "[warn] app 专用密码通常形如 abcd-efgh-ijkl-mnop; 当前值形状不同, 继续但请自行确认。"
}

# ---- 4. 写入 5 个 secrets ----
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($resolved))
$secrets = [ordered]@{}
foreach ($name in $secretNames) { $secrets[$name] = "" }
$secrets["MAC_CERT_P12_BASE64"] = $b64
$secrets["MAC_CERT_PASSWORD"] = $P12Password
$secrets["APPLE_ID"] = $AppleId
$secrets["APPLE_APP_SPECIFIC_PASSWORD"] = $AppPassword
$secrets["APPLE_TEAM_ID"] = $TeamId

foreach ($name in $secrets.Keys) {
  # 值经管道进 gh 的 stdin, 不进命令行参数。
  $secrets[$name] | gh secret set $name -R $Repo | Out-Null
  if ($LASTEXITCODE -ne 0) { Bad "写入 $name 失败"; exit 1 }
  Good "已写入 $name"
}

# ---- 5. 回读确认 ----
Write-Host "`n$Repo 现有 secrets:" -ForegroundColor Cyan
$list = gh secret list -R $Repo
$list | ForEach-Object { Info $_ }
$missing = @()
foreach ($name in $secrets.Keys) { if ($list -notmatch [regex]::Escape($name)) { $missing += $name } }
if ($missing.Count -gt 0) { Bad "回读时缺少: $($missing -join ', ')"; exit 1 }
Good "5 个 secret 全部就位"

# ---- 6. 下一步 ----
Write-Host "`n接下来(顺序不能换):" -ForegroundColor Cyan
Info "1. 编辑 /VERSION 指向本次发布号"
Info "2. 触发构建:  gh workflow run build-desktop -R $Repo -f version=<版本号>"
Info "3. 等 draft release 生成, 检查 mac 两个 dmg 的签名门禁是否通过"
Info "4. 人工验证后再发布 draft"
Info ""
Info "签名未生效时的排查顺序:"
Info "  - CI 日志里搜 'skipped macOS application code signing' —— 出现即说明证书没被读到"
Info "  - 确认 workflow 的 mac 打包步骤里没有 CSC_IDENTITY_AUTO_DISCOVERY=false(有则证书会被忽略)"
Info ""
