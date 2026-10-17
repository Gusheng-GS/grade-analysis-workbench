# -*- coding: utf-8 -*-
"""
交付前的最终整体验证：在"交付文件夹原样"的状态下走一遍老师的双击流程。

  ① data-0.2.1 清空、_开发文件 清掉 —— 模拟老师第一次拿到文件夹
  ② 跑 DSH成绩分析工作台.exe（端口用 3087，避免撞上开发者自己的 3080）
  ③ 确认：日志自动生成在交付文件夹内、程序目录=app-0.2.1、数据目录=data-0.2.1、
          服务真的起来了
  ④ 结束后把 data-0.2.1 和 _开发文件 恢复成"出厂"状态
"""
import os
import shutil
import socket
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from testutil_process import ensure_port_free, kill_app_node

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
EXE = os.path.join(P, "DSH成绩分析工作台.exe")
HOME = os.path.join(P, "data-0.2.1")
LOG = os.path.join(P, "_开发文件", "启动日志.txt")
PORT = 3097

# 开始前先确认端口没被残留进程占着（否则启动器会以为「已在运行」而不启动）
ensure_port_free(PORT, "交付整体验证")

# ── ① 恢复出厂状态 ──
if os.path.exists(HOME):
    shutil.rmtree(HOME)
if os.path.exists(os.path.join(P, "_开发文件")):
    shutil.rmtree(os.path.join(P, "_开发文件"))
print("已清空 data-0.2.1 与 _开发文件（模拟老师第一次拿到）")
print("交付文件夹:", sorted(os.listdir(P)))
print()


def listening(port):
    s = socket.socket()
    s.settimeout(0.4)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


# ── ② 跑 exe ──
proc = subprocess.Popen([EXE, str(PORT)], cwd=P)
print("已双击启动器 PID=%d（端口 %d）" % (proc.pid, PORT))

text = ""
deadline = time.time() + 90
while time.time() < deadline:
    if os.path.exists(LOG):
        text = open(LOG, encoding="utf-8", errors="replace").read()
        if "=== 启动完成" in text or "失败提示" in text:
            break
    time.sleep(0.5)

ready = listening(PORT)
time.sleep(0.5)
try:
    proc.kill()
except Exception:
    pass

print()
print("--- 启动器日志 ---")
print(text.strip() or "(空)")

# ── ③ 断言 ──
checks = [
    ("日志自动生成在交付文件夹内", os.path.exists(LOG)),
    ("日志路径正确", LOG.lower().endswith(os.path.join("_开发文件", "启动日志.txt").lower())),
    ("程序目录解析为 app-0.2.1", "app-0.2.1" in text),
    ("用的是 runtime\\node.exe", "runtime\\node.exe" in text or "runtime\\\\node.exe" in text),
    ("端口 3087 真的起来了", ready),
    ("启动流程走完", "=== 启动完成" in text),
    ("data-0.2.1 首次运行自动生成", os.path.exists(HOME)),
]
bad = []
print()
for name, ok in checks:
    print("%s %s" % ("[OK]  " if ok else "[FAIL]", name))
    if not ok:
        bad.append(name)

# 清理起起来的 node：
# 注意不能用 taskkill /IM node.exe —— 会连 3080 上的日常 DSH 一起杀掉。
# 这里只按路径精确杀交付目录里的 runtime\node.exe，由脚本外的一步完成。
print()

# ── ④ 恢复出厂状态 ──
if os.path.exists(HOME):
    shutil.rmtree(HOME)
if os.path.exists(os.path.join(P, "_开发文件")):
    shutil.rmtree(os.path.join(P, "_开发文件"))
print("已恢复出厂状态（data-0.2.1 / _开发文件 已清掉，老师首次运行会自动生成）")
print()
print("===== 交付文件夹最终清单 =====")
for n in sorted(os.listdir(P)):
    p = os.path.join(P, n)
    if os.path.isdir(p):
        cnt = sum(len(f) for _, _, f in os.walk(p))
        print("   %-16s <DIR>  %6d 个文件" % (n, cnt))
    else:
        print("   %-16s %8.1f KB" % (n, os.path.getsize(p) / 1024))

print()
if bad:
    print("!! 失败项:", bad)
    raise SystemExit(1)
print("===== 最终整体验证通过 =====")
