@echo off
chcp 65001 >nul
setlocal
set "HC_DIR=%~dp0"

echo.
echo  ==============================================
echo    HyperCode 一键安装向导
echo    最强大的 AI 编程软件与工作助手
echo  ==============================================
echo.

echo  [1/4] 安装程序到你的电脑...
setx PATH "%PATH%;%HC_DIR%" >nul

echo  [2/4] 配置内置技能(228+ 领域技能,自动加载)...
powershell -ExecutionPolicy Bypass -File "%HC_DIR%bake\bake.ps1" >nul 2>&1

echo  [3/4] 配置 AI 模型
echo.
echo    HyperCode 需要你的 DeepSeek API key:
echo    1. 打开浏览器访问 https://platform.deepseek.com
echo    2. 免费注册,点左侧"API keys"创建 key,复制
echo    3. 回到这里,粘贴 key 后按回车
echo    (key 只保存在你自己电脑上,不会上传)
echo.
set /p DSKEY="  粘贴你的 DeepSeek API key: "

echo.
echo  [4/4] 验证并保存...
curl.exe -s -m 25 -o NUL -w "" -H "Authorization: Bearer %DSKEY%" https://api.deepseek.com/models
if errorlevel 1 goto KEYFAIL

powershell -NoProfile -Command "$t = Get-Content -Raw -Encoding UTF8 '%HC_DIR%bake\templates\hypercode.json'; $t = $t.Replace('__HC_API_KEY__', '%DSKEY%'); $d = Join-Path $env:APPDATA 'hypercode'; New-Item -ItemType Directory -Force -Path $d | Out-Null; [System.IO.File]::WriteAllText((Join-Path $d 'hypercode.json'), $t, (New-Object System.Text.UTF8Encoding($false)))"
if errorlevel 1 goto KEYFAIL

echo.
echo  ==============================================
echo    ✔ 安装完成!key 验证通过。
echo  ==============================================
echo.
echo    现在打开【新的】终端窗口,输入:  hypercode
echo    就可以开始使用了。例如:
echo      "帮我写一个 xxx 功能"
echo      "帮我做一份融资 PPT"
echo      "帮我审查这份合同"
echo.
goto END

:KEYFAIL
echo.
echo  [!] key 验证失败(网络问题或 key 不对)。
echo      请重新双击本安装程序,粘贴正确的 key。
echo.

:END
pause
