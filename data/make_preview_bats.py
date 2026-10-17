# -*- coding: utf-8 -*-
"""
生成"预览/测试"用的一对 bat，放在 _开发文件\\ 下。

为什么需要：
  交付用的 启动.bat 用 3080，而开发者自己电脑上的 3080 正跑着日常 DSH，
  直接双击会被判定为"已在运行"。所以给一个独立端口的预览脚本：
    · 端口 3086（不和日常实例抢）
    · 数据目录单独用 _开发文件\\data-preview（不污染交付用的 data-0.2.1）
"""
import os

P = os.path.abspath(r"DSH成绩分析工作台")
ROOT = os.path.dirname(P)
DEV = os.path.join(ROOT, "DSH成绩分析工作台-开发文件")

START = r"""@echo off
rem 本文件是 GBK 编码。有些电脑的控制台默认用 UTF-8 代码页，
rem 会把中文读成乱码，所以这里强制切回 936（简体中文）再往下走。
chcp 936 >nul 2>&1
rem ============================================================
rem  预览 / 测试：用交付版程序(app-0.2.1)在端口 3086 起一个实例
rem
rem  用途：在自己电脑上先看看"老师会看到的样子"。
rem  特点：端口和数据目录都和日常实例分开 ——
rem        不会碰 3080 上的日常 DSH，也不会写脏交付用的 data-0.2.1。
rem ============================================================
setlocal
cd /d "%~dp0"

set "PORT=3086"
set "APPDIR=%~dp0..\DSH成绩分析工作台\app-0.2.1"
set "RUNTIME=%~dp0..\DSH成绩分析工作台\runtime\node.exe"
set "BIN=%APPDIR%\node_modules\@deepseek-ai\dsh\lib\bin.js"
set "DSH_HOME=%~dp0data-preview"

if not exist "%RUNTIME%" ( echo   [错误] 找不到运行环境 runtime\node.exe & pause & exit /b 1 )
if not exist "%BIN%" ( echo   [错误] 找不到程序文件 app-0.2.1 & pause & exit /b 1 )
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%"

netstat -ano | findstr "LISTENING" | findstr ":3086 " >nul 2>&1
if not errorlevel 1 (
    echo   预览实例已经在运行了。
    echo   如果浏览器里没看到，请手动打开 http://127.0.0.1:3086/
    echo.
    pause
    exit /b 0
)

echo.
echo   正在启动预览实例（端口 3086）...
echo   数据写在 _开发文件\data-preview，不影响交付用的 data-0.2.1。
echo.
echo   注意：启动后 dsh 会用带 token 的地址打开浏览器，
echo         直接手输 http://127.0.0.1:3086/ 会被拒绝（401）。
echo.

start "成绩分析工作台-预览" cmd /k ""%RUNTIME%" "%BIN%" web --port %PORT%"

ping -n 16 127.0.0.1 >nul 2>&1
echo   已尝试打开。若浏览器没自动打开，看上面那个窗口里打印出来的带 token 地址。
ping -n 4 127.0.0.1 >nul 2>&1
endlocal
"""

STOP = r"""@echo off
rem 本文件是 GBK 编码。有些电脑的控制台默认用 UTF-8 代码页，
rem 会把中文读成乱码，所以这里强制切回 936（简体中文）再往下走。
chcp 936 >nul 2>&1
rem ============================================================
rem  停止预览实例（端口 3086）
rem  只结束占用 3086 的进程，不会影响 3080 上的日常实例。
rem ============================================================
setlocal
set "PORT=3086"

set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    set "FOUND=1"
    echo   正在结束程序（PID=%%P）...
    taskkill /PID %%P /F >nul 2>&1
)

if not defined FOUND (
    echo   程序当前没有在运行。
) else (
    ping -n 2 127.0.0.1 >nul 2>&1
    netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul 2>&1
    if errorlevel 1 (
        echo   已停止。
    ) else (
        echo   常规方式没能结束，改用备用方式...
        for /f "tokens=5" %%Q in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
            powershell -NoProfile -Command "Stop-Process -Id %%Q -Force -ErrorAction SilentlyContinue" >nul 2>&1
        )
        ping -n 2 127.0.0.1 >nul 2>&1
        netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul 2>&1
        if errorlevel 1 ( echo   已停止。 ) else ( echo   没能停止，请重启电脑后再试。 )
    )
)

ping -n 2 127.0.0.1 >nul 2>&1
echo.
echo   按任意键关闭本窗口。
pause >nul
endlocal
"""

# 注意：停止脚本有两个生成器（这里和 make_stop_bats.py）。
# 两个都生成时后者会覆盖前者 —— 曾经因此把带 PowerShell 兜底的版本覆盖回
# 没有兜底的旧版，导致"停止"实际杀不掉进程（测试抓到了）。
# 现在两边的模板内容保持一致，都用带兜底的版本。
for name, text in (("启动-新版预览.bat", START), ("停止-新版预览.bat", STOP)):
    path = os.path.join(DEV, name)
    # cmd.exe 按 ANSI(GBK) 解析 bat，且必须 CRLF
    data = text.replace("\n", "\r\n").encode("gbk")
    with open(path, "wb") as f:
        f.write(data)
    print("已生成 %-22s %d bytes" % (name, len(data)))
