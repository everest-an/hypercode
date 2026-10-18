# HyperCode 一键连接 —— 安装向导用的设备码配对客户端(Windows)。
#
# 产品要求: 用户在本站注册/付费, 永远不需要看到或复制 API Key。这里打开授权页, 等用户点一次
# "授权", 然后把服务端发回来的 key 交给调用方写入配置。
#
# 契约:
#   成功  → stdout 只有一行: API Key; 进度全部走 stderr; exit 0
#   失败  → stdout 为空; 原因在 stderr; exit 非 0(调用方回退到手动粘贴)
#
# 环境变量:
#   HYPERCODE_API          后端接口根地址(默认 https://api.trust3.pro); 预发/测试可覆盖
#                          (页面在 www.trust3.pro, 接口在 api.trust3.pro —— 静态站点对
#                           POST /api/v1/* 返回 405, 授权页地址由 verification_uri 给出)
#   HYPERCODE_NO_BROWSER=1 不尝试打开浏览器(SSH/无桌面环境), 只打印链接
$ErrorActionPreference = "Stop"

$api = if ($env:HYPERCODE_API) { $env:HYPERCODE_API } else { "https://api.trust3.pro" }

function Note([string]$message) { [Console]::Error.WriteLine($message) }

# 老版 .NET Framework 默认只谈 TLS 1.0, 站点只接 1.2+。
try { [Net.ServicePointManager]::SecurityProtocol = 3072 } catch {}

function PostJson([string]$url, [string]$body) {
  return Invoke-RestMethod -TimeoutSec 25 -Method Post -Uri $url -ContentType "application/json" -Body $body
}

try {
  $code = PostJson "$api/api/v1/hypercode/device/code" "{}"
} catch {
  Note "  [!] 连接服务没有响应(站点不可达,或该功能尚未开放)。"
  Note "      $($_.Exception.Message)"
  exit 1
}

$deviceCode = $code.data.device_code
$userCode = $code.data.user_code
$verifyUri = $code.data.verification_uri
$interval = if ($code.data.interval) { [int]$code.data.interval } else { 5 }
$expiresIn = if ($code.data.expires_in) { [int]$code.data.expires_in } else { 600 }

if (-not $deviceCode -or -not $userCode) {
  Note "  [!] 连接服务返回了无法识别的应答。"
  exit 1
}

Note ""
Note "   配对码: $userCode"
Note "   请在浏览器里登录,然后点一下「授权此设备」。"
if ($env:HYPERCODE_NO_BROWSER -ne "1") {
  try {
    Start-Process $verifyUri | Out-Null
  } catch {
    Note "   (没能自动打开浏览器,请手动访问: $verifyUri)"
  }
} else {
  Note "   (已跳过打开浏览器,请手动访问: $verifyUri)"
}
Note ""

# 每 interval 秒问一次; 到 expires_in 就放弃, 不把用户留在等待里。
$deadline = (Get-Date).AddSeconds($expiresIn)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $interval
  $poll = $null
  try {
    $poll = PostJson "$api/api/v1/hypercode/device/token" (ConvertTo-Json @{ device_code = $deviceCode } -Compress)
  } catch {
    # 单次轮询失败(此刻网络抖动)不该结束配对, 交给外层截止时间收场。
    continue
  }

  if ($poll.data.status -eq "approved") {
    if ($poll.data.api_key) {
      Write-Output $poll.data.api_key
      exit 0
    }
    Note "  [!] 授权成功,但没有收到密钥。"
    exit 1
  }
  if ($poll.data.status -eq "expired") {
    Note "  [!] 配对码已过期,请重新连接。"
    exit 1
  }
}

Note "  [!] 等待授权超时。"
exit 1
