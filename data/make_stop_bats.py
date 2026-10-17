# -*- coding: utf-8 -*-
"""
生成/加固两个"停止"脚本：
  ① 交付用        DSH成绩分析工作台\\停止.bat          端口 3080
  ② 开发预览用    DSH成绩分析工作台\\_开发文件\\停止-新版预览.bat   端口 3086

为什么要加兜底：实测在本机上 taskkill /PID .. /F 有时返回 "Access denied"，
进程没被杀掉，老师按了"停止"却停不掉。所以 taskkill 之后再确认一次端口，
还在监听就改用 PowerShell 的 Stop-Process 再杀一次。
"""
import os

P = os.path.abspath(r"DSH成绩分析工作台")
ROOT = os.path.dirname(P)
DEV = os.path.join(ROOT, "DSH成绩分析工作台-开发文件")

TEMPLATE = r"""@echo off
rem 本文件是 GBK 编码。有些电脑的控制台默认用 UTF-8 代码页，
rem 会把中文读成乱码，所以这里强制切回 936（简体中文）再往下走。
chcp 936 >nul 2>&1
rem ============================================================
rem  {title}
rem
rem  只结束占用端口 {port} 的进程，不会动其它端口上的服务。
rem  先试 taskkill，个别机器上它会被拒，脚本会自动改用备用方式再试一次。
rem ============================================================
setlocal
set "PORT={port}"

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

echo.
echo   按任意键关闭本窗口。
pause >nul
endlocal
"""

targets = [
    (os.path.join(P, "停止.bat"), "成绩分析工作台 - 停止后台程序", 3080),
    (os.path.join(DEV, "停止-新版预览.bat"), "停止预览实例（新版程序）", 3086),
]

for path, title, port in targets:
    text = TEMPLATE.replace("{title}", title).replace("{port}", str(port))
    data = text.replace("\n", "\r\n").encode("gbk")
    with open(path, "wb") as f:
        f.write(data)
    print("已生成 %-46s %d bytes (端口 %d)" % (os.path.relpath(path, P), len(data), port))
