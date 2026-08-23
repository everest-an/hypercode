@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "HC_DIR=%~dp0"
rem %~dp0 必带尾部反斜杠,不去掉的话传给子进程会变成 \" 转义引号
if "%HC_DIR:~-1%"=="\" set "HC_DIR=%HC_DIR:~0,-1%"
set "HC_LOG=%TEMP%\hypercode-setup.log"

rem ---- 兼容两种发行布局:bake.ps1 与 setup.bat 同级,或在 bake\ 子目录下 ----
set "HC_BAKE=%HC_DIR%\bake\bake.ps1"
if not exist "%HC_BAKE%" set "HC_BAKE=%HC_DIR%\bake.ps1"
if not exist "%HC_BAKE%" goto NOBAKE

echo.
echo  ==============================================
echo    HyperCode 一键安装向导
echo    最强大的 AI 编程软件与工作助手
echo  ==============================================
echo.

echo  [1/4] 安装程序到你的电脑...
rem 绝不使用 setx:setx 有 1024 字符硬上限,而 cmd 的 %%PATH%% 是 Machine+User 合并值,
rem 回写会截断并永久损坏用户 PATH。改为只读写 User 作用域,精确判重后追加。
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=$env:HC_DIR; $p=[Environment]::GetEnvironmentVariable('Path','User'); if($null -eq $p){$p=''}; $parts=@($p -split ';' | Where-Object {$_.Trim() -ne ''}); if($parts -contains $d){Write-Output ('[setup] PATH already contains ' + $d); exit 0}; $parts+=$d; [Environment]::SetEnvironmentVariable('Path',($parts -join ';'),'User'); Write-Output ('[setup] added to user PATH: ' + $d); exit 0"
if errorlevel 1 goto PATHFAIL
rem 只改本进程 PATH(不落盘),好让下一步能找到 hypercode
set "PATH=%PATH%;%HC_DIR%"

echo  [2/4] 配置内置技能(228+ 领域技能,自动加载)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HC_BAKE%" > "%HC_LOG%" 2>&1
if errorlevel 1 goto BAKEFAIL

echo  [3/4] 配置 AI 模型
echo.
echo    HyperCode 需要你的 DeepSeek API key:
echo    1. 打开浏览器访问 https://platform.deepseek.com
echo    2. 免费注册,点左侧"API keys"创建 key,复制
echo    3. 回到这里,粘贴 key 后按回车
echo    (key 只保存在你自己电脑上,不会上传)
echo.
set "HC_API_KEY="
set /p HC_API_KEY="  粘贴你的 DeepSeek API key: "

echo.
echo  [4/4] 验证并保存...
rem key 通过环境变量 HC_API_KEY 传给 powershell,绝不拼进命令行
rem (命令行任何本地进程都能用 Win32_Process.CommandLine 读到,而且引号会被注入破坏)
rem 退出码: 0=通过 2=空 3=前缀不对 4=接口拒绝/网络失败
powershell -NoProfile -ExecutionPolicy Bypass -Command "$k=$env:HC_API_KEY; if($null -eq $k){exit 2}; $k=$k.Trim(); if($k.Length -eq 0){exit 2}; if(-not $k.StartsWith('sk-')){exit 3}; try{[Net.ServicePointManager]::SecurityProtocol=3072}catch{}; $h=@{Authorization=('Bearer '+$k)}; try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 -Uri 'https://api.deepseek.com/models' -Headers $h}catch{exit 4}; if($r.StatusCode -ne 200){exit 4}; exit 0"
set "HC_RC=%ERRORLEVEL%"
if "%HC_RC%"=="2" goto KEYEMPTY
if "%HC_RC%"=="3" goto KEYPREFIX
if not "%HC_RC%"=="0" goto KEYFAIL

rem 写配置:交给 bake.ps1 -ConfigOnly。它做字段级 apiKey 更新 + 原子替换,
rem 已有配置里用户自己加的 provider/model/plugin 全部保留。
powershell -NoProfile -ExecutionPolicy Bypass -File "%HC_BAKE%" -ConfigOnly >> "%HC_LOG%" 2>&1
if errorlevel 1 goto CFGFAIL
set "HC_API_KEY="

echo.
echo  ==============================================
echo    ✔ 安装完成!key 验证通过。
echo  ==============================================
echo.
echo    配置文件: %USERPROFILE%\.config\hypercode\hypercode.json
echo.
echo    现在打开【新的】终端窗口,输入:  hypercode
echo    就可以开始使用了。例如:
echo      "帮我写一个 xxx 功能"
echo      "帮我做一份融资 PPT"
echo      "帮我审查这份合同"
echo.
goto END

:NOBAKE
echo.
echo  [!] 安装包不完整:找不到 bake.ps1。
echo      请重新下载完整安装包后再试。
echo.
goto END

:PATHFAIL
echo.
echo  [!] 写入 PATH 失败。你的 PATH 没有被改动。
echo      请右键本文件选择"以管理员身份运行"后重试。
echo.
goto END

:BAKEFAIL
echo.
echo  [!] 内置技能安装失败,安装已中止。
echo      详细日志: %HC_LOG%
echo.
goto END

:KEYEMPTY
echo.
echo  [!] 你没有输入 key(直接按了回车)。
echo      请重新双击本安装程序,粘贴 key 后再回车。
echo.
goto END

:KEYPREFIX
echo.
echo  [!] key 格式不对:DeepSeek 的 key 以 sk- 开头。
echo      请回到 https://platform.deepseek.com 重新复制完整的 key。
echo.
goto END

:KEYFAIL
echo.
echo  [!] key 验证失败:DeepSeek 拒绝了这个 key,或者网络连不通。
echo      请检查 key 是否复制完整、账户是否欠费,然后重新运行本安装程序。
echo.
goto END

:CFGFAIL
echo.
echo  [!] 写入配置文件失败。
echo      详细日志: %HC_LOG%
echo.

:END
pause
