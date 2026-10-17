# -*- coding: utf-8 -*-
"""
测试新版 启动.bat 的两条路径（用改过端口的临时副本，绝不动真实的 3080）：

  A. 正常启动 : 应该等端口通了、然后报"已打开..."
  A2.再点一次 : 应该报"程序已经在运行了"（不重复起服务）
  B. 启动失败 : 把 BIN 指向一个坏文件，应该报"启动似乎没有成功"并说明发什么给技术人员

为了避免测试时弹出黑窗口和浏览器标签页，测试副本里：
  · PORT 改成 3089 / 3090
  · 打开浏览器那行改成 echo
  · start ... cmd /k（可见窗口）改成 start "" /b cmd /c（后台，不弹窗）
  · DSH_HOME 指向 _devtest_home（不污染交付用的 data-0.2.1）
"""
import os
import shutil
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
SRC = os.path.join(P, "启动.bat")
# 测试日志写到 _backup 下，不留在交付文件夹里
# （以前留在里面，跑完测试 delivery 体检就会报"根目录有多余文件"）
LOGDIR = os.path.join(ROOT, "_backup", "battest-" + time.strftime("%Y%m%d-%H%M%S"))
os.makedirs(LOGDIR, exist_ok=True)

raw = open(SRC, "rb").read().decode("gbk")


def make_copy(name, port, bin_path=None, home="_devtest_home"):
    t = raw.replace('set "PORT=3080"', 'set "PORT=%d"' % port)
    t = t.replace('start "" "http://127.0.0.1:%PORT%/"',
                  'echo   [测试] 这里原本会打开浏览器')
    t = t.replace('start "成绩分析工作台" cmd /k ', 'start "" /b cmd /c ')
    t = t.replace('set "DSH_HOME=%~dp0data-0.2.1"', 'set "DSH_HOME=%~dp0' + home + '"')
    if bin_path:
        t = t.replace('set "BIN=%APPDIR%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"',
                      'set "BIN=%~dp0' + bin_path + '"')
    p = os.path.join(P, name)
    open(p, "wb").write(t.replace("\n", "\r\n").encode("gbk"))
    return p


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


def run(bat, logname, timeout=180):
    """跑 bat，并把它的输出写进文件再读。

    不能用管道抓输出：bat 里 start 出来的 node 会继承这个管道，
    管道一直不关，读取就会永远卡住（第一版测试就卡在这）。
    """
    logf = os.path.join(LOGDIR, logname)
    if os.path.exists(logf):
        os.remove(logf)
    cmd = 'cmd /c ""%s" > "%s" 2>&1"' % (bat, logf)
    subprocess.run(cmd, shell=True, cwd=P,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   timeout=timeout)
    raw = open(logf, "rb").read()
    try:
        # 本机控制台是 UTF-8 代码页，cmd 的输出就是 UTF-8；普通机器是 GBK
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gbk", "replace")


fails = []


def check(label, cond, extra=""):
    print("%s %s %s" % ("[OK]  " if cond else "[FAIL]", label, extra))
    if not cond:
        fails.append(label)


try:
    # ── A. 正常启动 ──
    print("===== A. 正常启动（端口 3089）=====")
    batA = make_copy("_测试A.bat", 3089)
    outA = run(batA, "_testA.log")
    print(outA.strip()[-700:])
    print()
    check("A 报出已打开页面", "已打开 http://127.0.0.1:3089/" in outA)
    check("A 没有误报失败", "启动似乎没有成功" not in outA)

    # ── A2. 服务已在运行时再点一次 ──
    if listening(3089):
        print()
        print("===== A2. 服务在跑时再点一次 =====")
        outA2 = run(batA, "_testA2.log", timeout=60)
        print(outA2.strip()[-500:])
        check("A2 报出已在运行", "程序已经在运行了" in outA2)
    else:
        check("A2 跳过（3089 没起来）", False)

    # 注意：这里绝对不能用 taskkill /IM node.exe —— 那会把 3080 上正在跑的
    # 日常 DSH 一起杀掉。测试实例的清理放到脚本外面，只按路径精确杀。
    time.sleep(1)

    # ── B. 启动失败 ──
    print()
    print("===== B. 启动失败（把程序文件换成坏文件，端口 3090）=====")
    bad = os.path.join(P, "_devtest_bad_bin.js")
    open(bad, "w", encoding="utf-8").write("this is not javascript at all {{{ \n")
    batB = make_copy("_测试B.bat", 3090, bin_path="_devtest_bad_bin.js")
    outB = run(batB, "_testB.log", timeout=180)
    print(outB.strip()[-900:])
    print()
    check("B 报出启动未成功", "启动似乎没有成功" in outB)
    check("B 告诉老师要截图服务窗口", "截图" in outB)
    check("B 告诉老师要发启动日志", "启动日志.txt" in outB)
    check("B 没有去打开浏览器", "这里原本会打开浏览器" not in outB)

finally:
    # ── 清理（日志文件可能还被跑着的 node 占着，删不掉就算了）──
    for n in ("_测试A.bat", "_测试B.bat", "_devtest_bad_bin.js"):
        p = os.path.join(P, n)
        if os.path.exists(p):
            os.remove(p)
    home = os.path.join(P, "_devtest_home")
    if os.path.exists(home):
        shutil.rmtree(home, ignore_errors=True)
    shutil.rmtree(LOGDIR, ignore_errors=True)
    print()
    print("清理完成，交付文件夹内容:", sorted(os.listdir(P)))

print()
if fails:
    print("!! 失败项:", fails)
    sys.exit(1)
print("===== 启动.bat 测试通过 =====")
