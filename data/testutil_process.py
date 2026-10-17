# -*- coding: utf-8 -*-
"""
测试辅助：清理测试自己拉起来的 node 进程。

为什么需要：启动器是一个 launcher 进程，它再拉起一个 node 子进程。
测试里如果把 launcher 杀掉，node 子进程会继续占着端口 ——
后面的测试就以为"端口已被占用"，出现莫名其妙的失败（实际踩过）。

⚠ 匹配范围必须窄：默认只认**交付文件夹**（…\\DSH成绩分析工作台\\runtime\\node.exe）。
  用 *DSH成绩分析工作台* 这种宽匹配会把开发文件夹里的实例一起杀掉
  （…\\DSH成绩分析工作台-开发文件\\runtime\\node.exe 也会命中），实际踩过这个坑。
  另外绝不能用 taskkill /IM node.exe —— 那会连用户日常在跑的 DSH 一起杀。
"""
import os
import socket
import subprocess

PS = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

# 只匹配交付文件夹里的 runtime\node.exe（开发文件夹那条路径中间多了 "-开发文件"，不会命中）
PATTERN_DELIVERY = "*DSH成绩分析工作台" + chr(92) + "runtime" + chr(92) + "node.exe"
PATTERN_ALL = "*DSH成绩分析工作台*" + chr(92) + "runtime" + chr(92) + "node.exe"


def kill_app_node(scope="delivery", timeout=60):
    """杀掉我们自己的 node 进程，返回被杀的 PID 列表（可能为空）。

    scope="delivery"（默认）只杀交付文件夹那份；
    scope="all" 连开发文件夹那份也杀 —— 只在你明确想清场时用。
    """
    if not os.path.exists(PS):
        return []
    pattern = PATTERN_DELIVERY if scope == "delivery" else PATTERN_ALL
    script = (
        "$p = Get-Process node -ErrorAction SilentlyContinue | "
        "Where-Object { $_.Path -like '" + pattern + "' }; "
        "if ($p) { $p | ForEach-Object { Write-Output $_.Id; Stop-Process -Id $_.Id -Force } }"
    )
    try:
        r = subprocess.run([PS, "-NoProfile", "-Command", script],
                           capture_output=True, text=True, timeout=timeout)
        out = (r.stdout or "").strip()
        return [int(x) for x in out.split() if x.strip().isdigit()]
    except Exception:
        return []


def port_listening(port):
    s = socket.socket()
    s.settimeout(0.4)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def ensure_port_free(port, owner_hint=""):
    """测试开始前确认端口没被占；被占就先清掉我们自己残留的 node，再确认一次。"""
    if not port_listening(port):
        return True
    killed = kill_app_node()
    if killed:
        import time
        time.sleep(1.5)
    if port_listening(port):
        raise SystemExit(
            "端口 %d 被占用了，测试无法进行。\n"
            "如果是你自己在跑的实例，请先停掉它；\n"
            "残留的测试进程（只清交付文件夹那份）可以这样清：\n"
            "  Get-Process node | Where-Object { $_.Path -like '*DSH成绩分析工作台\\runtime\\node.exe' } | Stop-Process -Force\n"
            "%s" % (port, ("（" + owner_hint + "）") if owner_hint else ""))
    return True
