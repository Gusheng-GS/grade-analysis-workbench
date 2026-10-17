# -*- coding: utf-8 -*-
"""验证测试的进程清理逻辑只认"交付文件夹"，不会误杀"开发文件夹"的实例。

上一版的做法是起一个完整的 DSH 实例 —— 它会在 DSH_HOME 里写 188 MB 的文件，
清理时还撞上长路径，非常不划算。实际上要验的只是"路径匹配范围对不对"，
所以这里只起一个空转的 node 进程，可执行文件就是那个目录下的 runtime\\node.exe，
正好能验证匹配逻辑。
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from testutil_process import kill_app_node, PATTERN_DELIVERY

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV_NODE = os.path.join(ROOT, "DSH成绩分析工作台-开发文件", "runtime", "node.exe")
DEL_NODE = os.path.join(ROOT, "DSH成绩分析工作台", "runtime", "node.exe")

print("清理用的匹配模式:", PATTERN_DELIVERY)
print("开发文件夹的 node:", DEV_NODE)
print()

if not os.path.exists(DEV_NODE):
    print("跳过：开发文件夹里没有 runtime\\node.exe")
    sys.exit(0)

fails = []


def alive(p):
    return p.poll() is None


# ── ① 开发文件夹的 node：不应被误杀 ──
proc = subprocess.Popen([DEV_NODE, "-e", "setTimeout(function(){}, 60000)"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
print("起了一个开发文件夹路径的 node 进程 PID=%d" % proc.pid)
killed = kill_app_node()
print("调用 kill_app_node() -> 被杀的 PID:", killed)
time.sleep(1.0)
ok1 = alive(proc) and proc.pid not in killed
print("%s 开发文件夹的进程没有被误杀" % ("[OK]  " if ok1 else "[FAIL]"))
if not ok1:
    fails.append("误杀了开发文件夹的进程")
try:
    proc.kill()
except Exception:
    pass

# ── ② 交付文件夹的 node：应当被清理掉（否则测试残留会占着端口）──
if os.path.exists(DEL_NODE):
    p2 = subprocess.Popen([DEL_NODE, "-e", "setTimeout(function(){}, 60000)"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    print()
    print("起了一个交付文件夹路径的 node 进程 PID=%d" % p2.pid)
    killed2 = kill_app_node()
    print("调用 kill_app_node() -> 被杀的 PID:", killed2)
    time.sleep(1.0)
    ok2 = (not alive(p2)) or (p2.pid in killed2)
    print("%s 交付文件夹的进程被正确清理" % ("[OK]  " if ok2 else "[FAIL]"))
    if not ok2:
        fails.append("没清理掉交付文件夹的进程")
    try:
        p2.kill()
    except Exception:
        pass
else:
    print("跳过第二部分：交付文件夹里没有 runtime\\node.exe")

print()
if fails:
    print("!! 失败项:", fails)
    sys.exit(1)
print("===== 清理范围验证通过 =====")
