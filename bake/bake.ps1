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

# ---- 3. omo 受管块:标记间替换(幂等;块外用户编辑原样保留) ----
$omoCfg = Join-Path $omoDir "omo.jsonc"
$managed = Get-Content -LiteralPath (Join-Path $templates "omo-managed.jsonc") -Raw
$begin = "// === HYPERCODE MANAGED BEGIN ==="
$end = "// === HYPERCODE MANAGED END ==="
New-Item -ItemType Directory -Force -Path $omoDir | Out-Null

if (Test-Path -LiteralPath $omoCfg) {
    $existing = [System.IO.File]::ReadAllText($omoCfg)
    if ($existing.Contains($begin) -and $existing.Contains($end)) {
        # 替换 BEGIN..END 之间内容(含标记)
        $idxB = $existing.IndexOf($begin)
        $idxE = $existing.IndexOf($end) + $end.Length
        $new = $existing.Substring(0, $idxB) + $managed + $existing.Substring($idxE)
        [System.IO.File]::WriteAllText($omoCfg, $new, (New-Object System.Text.UTF8Encoding($false)))
        Write-Output "[bake] managed block updated: $omoCfg"
    } else {
        # 标记缺失:把受管块追加到末尾(JSONC 允许尾逗号)
        $new = $existing.TrimEnd() + "`r`n`r`n" + $managed
        [System.IO.File]::WriteAllText($omoCfg, $new, (New-Object System.Text.UTF8Encoding($false)))
        Write-Output "[bake] managed block appended: $omoCfg"
    }
} else {
    [System.IO.File]::WriteAllText($omoCfg, $managed, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "[bake] wrote omo config: $omoCfg"
}

# ---- 3.5 内置技能(系统区整体替换;用户自建技能在 skills/ 其他目录,永不覆盖) ----
$skillsSrc = Join-Path $PSScriptRoot "skills"
if (Test-Path -LiteralPath $skillsSrc) {
    $skillsDest = Join-Path $configDir "skills"
    New-Item -ItemType Directory -Force -Path $skillsDest | Out-Null
    foreach ($ns in @("hypercode-academic", "hypercode-finance")) {
        $srcDir = Join-Path $skillsSrc ($ns -replace "hypercode-", "")
        if (Test-Path -LiteralPath $srcDir) {
            $dstDir = Join-Path $skillsDest $ns
            if (Test-Path -LiteralPath $dstDir) { Remove-Item -LiteralPath $dstDir -Recurse -Force }
            Copy-Item -LiteralPath $srcDir -Destination $dstDir -Recurse -Force
        }
    }
    Write-Output "[bake] skills installed: $skillsDest"
}

# ---- 4. 插件安装(引擎自带插件管理器) ----
# 生产版:从 HyperCode CDN 下发插件包并本地安装(不走外网 npmjs)。
& hypercode plugin install oh-my-openagent
if ($LASTEXITCODE -ne 0) { Write-Warning "[bake] plugin install failed (exit $LASTEXITCODE)"; exit 1 }

Write-Output "[bake] done. HyperCode is ready."
