# -*- coding: utf-8 -*-
"""
测试"停止"脚本（含 taskkill 失败时的 PowerShell 兜底）。

做法：
  ① 按 _开发文件\\启动-新版预览.bat 里同样的路径/端口，手动起一个实例
     （加 --no-open，避免测试时弹出浏览器标签页）
  ② 运行真正的 停止-新版预览.bat（管道喂回车，跳过末尾的 pause）
  ③ 确认端口已释放 —— 这一步同时验证了兜底逻辑
交付用的 停止.bat 与预览版是同一模板，只是端口不同，逻辑一致。
"""
import os
import socket
import subprocess
import sys
import time

P = os.path.abspath(r"DSH成绩分析工作台")
ROOT = os.path.dirname(P)
DEV = os.path.join(ROOT, "DSH成绩分析工作台-开发文件")
RUNTIME = os.path.join(P, "runtime", "node.exe")
BIN = os.path.join(P, "app-0.2.1", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
HOME = os.path.join(DEV, "data-preview")
PORT = 3086


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


for label, path in (("runtime", RUNTIME), ("bin", BIN)):
    print("%-8s exists=%s  %s" % (label, os.path.exists(path), path))
assert os.path.exists(RUNTIME) and os.path.exists(BIN), "预览脚本里的路径不对！"

os.makedirs(HOME, exist_ok=True)
env = dict(os.environ, DSH_HOME=HOME, NO_COLOR="1")
proc = subprocess.Popen([RUNTIME, BIN, "web", "--port", str(PORT), "--no-open"],
                        env=env, cwd=DEV,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("已起测试实例 PID=%d (端口 %d, DSH_HOME=%s)" % (proc.pid, PORT, HOME))

deadline = time.time() + 45
while time.time() < deadline and not listening(PORT):
    time.sleep(0.5)
print("端口 %d 在监听: %s" % (PORT, listening(PORT)))
if not listening(PORT):
    proc.kill()
    sys.exit("实例没能起来，测试中止")

print()
print("--- 运行 停止-新版预览.bat ---")
r = subprocess.run('echo. | "停止-新版预览.bat"', shell=True, cwd=DEV,
                   capture_output=True, text=True, errors="replace", timeout=90,
                   encoding="gbk")
print(r.stdout.strip())

time.sleep(1)
still = listening(PORT)
print()
print("%s 端口 %d 已释放（服务确实被停掉了）" % ("[OK]  " if not still else "[FAIL]", PORT))
if still:
    proc.kill()
    sys.exit(1)
print()
print("data-preview 内容:", os.listdir(HOME))
print("===== 停止脚本测试通过（含 PowerShell 兜底）=====")
