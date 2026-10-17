# -*- coding: utf-8 -*-
"""
生成交付用的 启动.bat。

相比上一版，改了两处（都是为了"老师自己也能看出问题"）：

  ① 发现 update\\ 里有 .zip → 自动交给启动器(exe)安装更新。
     原来必须手动双击 exe，老师看说明书双击 启动.bat 的话更新不会生效。

  ② 起完服务后真的去确认端口有没有通：
     通了 → 打开浏览器
     没通 → 明确告诉老师"启动失败了"，并说明要截图哪个窗口、发哪个文件
     （原来不管成没成都会去开浏览器，失败了老师只看到一个打不开的页面）
"""
import os

P = os.path.abspath(r"DSH成绩分析工作台")

START = r"""@echo off
rem 本文件是 GBK 编码。有些电脑的控制台默认用 UTF-8 代码页，
rem 会把中文读成乱码，所以这里强制切回 936（简体中文）再往下走。
chcp 936 >nul 2>&1
rem ============================================================
rem  成绩分析工作台 - 启动
rem  双击本文件即可。
rem
rem  三种情况：
rem   1) update 文件夹里有 .zip  -> 交给启动器安装更新
rem   2) 程序已经在运行          -> 打开网页
rem   3) 正常启动                -> 起服务，起来后打开浏览器
rem
rem  服务在一个独立窗口里运行：那个窗口就是程序本体，不要关闭它。
rem ============================================================
setlocal
cd /d "%~dp0"

set "PORT=3080"
set "APPDIR=%~dp0app-0.2.1"
set "RUNTIME=%~dp0runtime\node.exe"
set "BIN=%APPDIR%\node_modules\@deepseek-ai\dsh\lib\bin.js"
set "DSH_HOME=%~dp0data-0.2.1"
set "LAUNCHER=%~dp0DSH成绩分析工作台.exe"

rem ── 1) 有更新包：必须交给启动器，只有它会装更新 ──
if exist "%~dp0update\*.zip" (
    echo.
    echo   发现更新包，正在交给启动器安装，请稍候...
    if exist "%LAUNCHER%" (
        start "" "%LAUNCHER%"
    ) else (
        echo   [错误] 找不到 DSH成绩分析工作台.exe，无法安装更新。
        echo   请把整个文件夹一起拷贝，不要只拷部分文件。
        pause
    )
    exit /b 0
)

if not exist "%RUNTIME%" ( echo   [错误] 找不到运行环境 runtime\node.exe，请把整个文件夹一起拷贝。 & pause & exit /b 1 )
if not exist "%BIN%" ( echo   [错误] 找不到程序文件 app-0.2.1，请把整个文件夹一起拷贝。 & pause & exit /b 1 )
if not exist "%DSH_HOME%" mkdir "%DSH_HOME%"

rem ── 2) 已经在运行 ──
netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul 2>&1
if not errorlevel 1 (
    echo.
    echo   程序已经在运行了，正在打开页面...
    start "" "http://127.0.0.1:%PORT%/"
    echo.
    echo   如果浏览器打开后显示"拒绝访问"或打不开，
    echo   请先双击「停止.bat」，再双击「启动.bat」。
    pause
    exit /b 0
)

echo.
echo   正在启动，请稍候...
echo   启动后浏览器会自动打开。
echo   新出现的那个窗口是程序本体，请不要关闭。
echo.

start "成绩分析工作台" cmd /k ""%RUNTIME%" "%BIN%" web --port %PORT%"

rem ── 3) 等端口通，最多约 35 秒 ──
set "OK="
for /l %%i in (1,1,30) do (
    netstat -ano | findstr "LISTENING" | findstr ":%PORT% " >nul 2>&1
    if not errorlevel 1 ( set "OK=1" & goto :ready )
    ping -n 2 127.0.0.1 >nul 2>&1
)

:ready
if defined OK (
    start "" "http://127.0.0.1:%PORT%/"
    echo   已打开 http://127.0.0.1:%PORT%/
    echo   如果浏览器提示连不上，等几秒刷新一次。本窗口可以关闭。
    ping -n 4 127.0.0.1 >nul 2>&1
) else (
    echo.
    echo   ==========================================================
    echo    启动似乎没有成功。
    echo.
    echo    请把上面那个服务窗口里的内容截图（失败原因就写在里面），
    echo    连同文件  _开发文件\启动日志.txt  一起发给技术人员。
    echo   ==========================================================
    echo.
    echo   按任意键关闭本窗口。
    pause >nul
)
endlocal
"""

path = os.path.join(P, "启动.bat")
data = START.replace("\n", "\r\n").encode("gbk")
with open(path, "wb") as f:
    f.write(data)
print("已生成 启动.bat  %d bytes" % len(data))

check = open(path, "rb").read()
check.decode("gbk")
assert check.count(b"\r\n") == check.count(b"\n"), "有裸 LF"
print("校验: GBK 可解码, CRLF 正常, 行数 %d" % check.count(b"\r\n"))
