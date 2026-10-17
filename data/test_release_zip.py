# -*- coding: utf-8 -*-
"""
对发布 zip 做一次端到端验证（发布前跑一遍）：

  1. 解压到临时目录（路径会超 260 字符，所以自己加长路径前缀，不能用 extractall）
  2. 用改过名字的 exe 在 3098 端口起一遍（**不要用 3080**，那是使用者正在用的端口）
  3. 检查 dist/index.html 有没有被注入工作台界面、/_workbench.html 能不能取到
  4. 关掉自己起的进程（taskkill 常被拒，用 Stop-Process），确认端口已释放
  5. 检查 data-0.2.1 / 启动日志有没有正常生成，最后清理解压目录

用法：
    python data/test_release_zip.py
    python data/test_release_zip.py --zip build/xxx.zip --port 3098
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
APPNAME = "成绩分析工作台"


def longpath(p):
    ap = os.path.abspath(p)
    if os.name == "nt" and not ap.startswith("\\\\?\\"):
        return "\\\\?\\" + ap
    return ap


def rm_long(p):
    if not os.path.exists(longpath(p)):
        return
    for r, d, fs in os.walk(longpath(p), topdown=False):
        for f in fs:
            try:
                os.remove(os.path.join(r, f))
            except Exception:
                pass
        for dn in d:
            try:
                os.rmdir(os.path.join(r, dn))
            except Exception:
                pass
    try:
        os.rmdir(longpath(p))
    except Exception:
        pass


def listening(port):
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                         errors="replace").stdout
    pids = set()
    for line in out.splitlines():
        if "LISTENING" in line and (":%d " % port) in line:
            pids.add(line.split()[-1])
    return pids


def http(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read()


def find_zip():
    build = os.path.join(REPO, os.pardir, "build")
    if not os.path.isdir(build):
        return None
    zips = [os.path.join(build, f) for f in os.listdir(build) if f.endswith(".zip")]
    return max(zips, key=os.path.getmtime) if zips else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=None)
    ap.add_argument("--port", type=int, default=3098)
    args = ap.parse_args()

    zp = args.zip or find_zip()
    if not zp or not os.path.exists(zp):
        raise SystemExit("找不到发布 zip，请用 --zip 指定")
    PORT = args.port
    verify = os.path.join(REPO, os.pardir, "build", "_verify")

    print("zip:", zp)
    print("端口: %d" % PORT)
    rm_long(verify)
    os.makedirs(verify, exist_ok=True)

    print()
    print("① 解压 …")
    t0 = time.time()
    with zipfile.ZipFile(zp) as z:
        for info in z.infolist():
            target = os.path.join(verify, info.filename.replace("/", os.sep))
            if info.is_dir():
                os.makedirs(longpath(target), exist_ok=True)
                continue
            os.makedirs(longpath(os.path.dirname(target)), exist_ok=True)
            with z.open(info) as src, open(longpath(target), "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
    print("   完成，用时 %.0f 秒" % (time.time() - t0))

    base = os.path.join(verify, APPNAME)
    exe = os.path.join(base, APPNAME + ".exe")
    print("   exe 存在:", os.path.exists(exe))
    print("   顶层条目:", sorted(os.listdir(base)))

    print()
    print("② 启动 …")
    if listening(PORT):
        raise SystemExit("端口 %d 已被占用，先清理" % PORT)
    proc = subprocess.Popen([exe, str(PORT)], cwd=base,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ready = False
    for _ in range(90):
        if listening(PORT):
            ready = True
            break
        if proc.poll() is not None:
            print("   启动器提前退出，返回码", proc.returncode)
            break
        time.sleep(1)
    print("   端口就绪:", ready)

    checks = {}
    if ready:
        idx = os.path.join(base, "app-0.2.1", "node_modules", "@deepseek-ai",
                          "dsh-web-frontend", "dist", "index.html")
        html = open(longpath(idx), encoding="utf-8", errors="replace").read() \
            if os.path.exists(longpath(idx)) else ""
        checks["dist/index.html 注入了 workbench-layer"] = "workbench-layer" in html
        checks["dist/index.html 有 wb-toggle 按钮"] = "wb-toggle" in html
        # 启动器注入页面有几百毫秒延迟，这里重试几次再判定
        text, code = "", 0
        for _ in range(15):
            try:
                code, body = http("http://127.0.0.1:%d/_workbench.html" % PORT)
                text = body.decode("utf-8", "replace")
                if code == 200 and "WuyueParse" in text:
                    break
            except Exception as e:
                code = -1
                text = ""
                last_err = e
            time.sleep(1)
        checks["_workbench.html 可访问且有解析器"] = (code == 200 and "WuyueParse" in text)
        print("   _workbench.html HTTP %s，长度 %d" % (code, len(text)))

    print()
    print("③ 关掉自己起的进程 …")
    pids = listening(PORT)
    for pid in pids:
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Stop-Process -Id %s -Force -ErrorAction SilentlyContinue" % pid],
                       capture_output=True)
    try:
        proc.kill()
    except Exception:
        pass
    remain = set()
    for _ in range(15):
        time.sleep(1)
        remain = listening(PORT)
        if not remain:
            break
    print("   结束 PID:", sorted(pids), "| 剩余:", sorted(remain))

    print()
    print("④ 产物检查 …")
    data_dir = os.path.join(base, "data-0.2.1")
    log = os.path.join(base, "_开发文件", "启动日志.txt")
    print("   data-0.2.1 已生成:", os.path.isdir(data_dir))
    print("   启动日志已生成:", os.path.exists(log))
    if os.path.exists(log):
        with open(log, encoding="utf-8", errors="replace") as f:
            for line in f.read().splitlines()[:4]:
                print("      ", line)

    ok = ready and all(checks.values()) and os.path.isdir(data_dir) and not remain

    print()
    print("⑤ 清理 …")
    rm_long(verify)
    print("   已删除解压目录（保留源 zip）")

    print()
    for k, v in checks.items():
        print("   %s %s" % ("[OK]" if v else "[!!]", k))
    print()
    print("===== 端到端验证 %s =====" % ("通过" if ok else "未通过"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
