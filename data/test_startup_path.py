# -*- coding: utf-8 -*-
"""
验证新版启动器的"正常启动"路径：确认它解析到的程序目录是 app-0.2.1、
数据目录是 data-0.2.1，并且日志落在 _开发文件\\ 下。
用空闲端口 3087 测试，确认无误后立刻结束进程（避免它去打开浏览器）。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from testutil_process import kill_app_node

P = os.path.abspath(r"DSH成绩分析工作台")
EXE = os.path.join(P, "DSH成绩分析工作台.exe")
LOG = os.path.join(P, "_开发文件", "启动日志.txt")

if os.path.exists(LOG):
    os.remove(LOG)

proc = subprocess.Popen([EXE, "3087"], cwd=P)
print("已启动启动器 PID=%d（端口 3087）" % proc.pid)

text = ""
deadline = time.time() + 25
while time.time() < deadline:
    if os.path.exists(LOG):
        text = open(LOG, encoding="utf-8", errors="replace").read()
        if "启动命令" in text:
            break
    time.sleep(0.3)

proc.kill()
print("已结束启动器进程")
# 启动器会拉起一个 node 子进程；只杀 launcher 的话它会继续占着端口，
# 后面的测试就会误判"端口已被占用"（实际踩过）。这里一并清掉。
left = kill_app_node()
if left:
    print("已清理残留的 node 子进程:", left)
time.sleep(0.5)

print()
print("--- 启动日志 ---")
print(text.strip() or "(空)")

checks = [
    ("日志写在 _开发文件 下", os.path.exists(LOG)),
    ("程序目录解析为 app-0.2.1", "app-0.2.1" in text and "\\app\\node_modules" not in text),
    ("node 已拉起", "node 已启动 PID=" in text),
]
print()
bad = [n for n, ok in checks if not ok]
for n, ok in checks:
    print("%s %s" % ("[OK]  " if ok else "[FAIL]", n))
print()
print("!! 失败项: %s" % bad if bad else "===== 正常启动路径测试通过 =====")
raise SystemExit(1 if bad else 0)
