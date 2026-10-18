# -*- coding: utf-8 -*-
"""
更新系统端到端测试（不碰老师的 3080，用 3095）。

验证链路：
  启动器 exe → 启动 node → 注入 window.__WB_UPDATER__ → 拉起 update_agent.js
  → 用页面里那个 token 调代理的 /status 和 /start（坏地址应被拒）

用法：python data\\test_update_integration.py
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = r"D:\01_Projects\Python_Projects\Student_Performance_Tracking_Dashboard"
DELIV = os.path.join(ROOT, "DSH成绩分析工作台")
EXE = os.path.join(DELIV, "DSH成绩分析工作台.exe")
PORT = 3095

passed = 0
failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("  [OK]  " + name)
    else:
        failed += 1
        print("  [!!]  " + name + (("  → " + str(detail)) if detail else ""))


def listening(port):
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                         errors="replace").stdout
    pids = set()
    for line in out.splitlines():
        if "LISTENING" in line and (":%d " % port) in line:
            pids.add(line.split()[-1])
    return pids


def http_json(url, token=None, body=None, method=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"))
    if token:
        req.add_header("X-WB-Token", token)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}


def kill_port(port):
    for pid in listening(port):
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Stop-Process -Id %s -Force -ErrorAction SilentlyContinue" % pid],
                       capture_output=True)
    for _ in range(15):
        time.sleep(1)
        if not listening(port):
            return True
    return False


print("① 启动程序（端口 %d）…" % PORT)
if listening(PORT):
    kill_port(PORT)
proc = subprocess.Popen([EXE, str(PORT)], cwd=DELIV,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ready = False
for _ in range(120):
    if listening(PORT):
        ready = True
        break
    if proc.poll() is not None:
        print("   启动器提前退出，返回码", proc.returncode)
        break
    time.sleep(1)
check("程序起来了（端口 %d）" % PORT, ready)
if not ready:
    sys.exit(1)

print()
print("② 检查注入到 index.html 的更新配置 …")
dist = os.path.join(DELIV, "app-0.2.1", "node_modules", "@deepseek-ai",
                    "dsh-web-frontend", "dist", "index.html")
html = open(dist, encoding="utf-8", errors="replace").read()
m = re.search(r"__WB_UPDATER__=(\{.*?\});", html)
check("页面里有 __WB_UPDATER__", bool(m))
cfg = {}
if m:
    raw = m.group(1)
    for k in ("agent", "token", "version", "repo"):
        mm = re.search(k + r":'([^']*)'", raw)
        cfg[k] = mm.group(1) if mm else ""
    check("带 agent 地址", bool(cfg.get("agent")), cfg.get("agent"))
    check("带 token", len(cfg.get("token", "")) >= 16, len(cfg.get("token", "")))
    check("版本是 0.1.1", cfg.get("version") == "0.1.1", cfg.get("version"))
    check("带仓库名", "grade-analysis-workbench" in cfg.get("repo", ""), cfg.get("repo"))

print()
print("③ 更新代理是否在跑 …")
agent = cfg.get("agent", "")
check("agent 地址形如 http://127.0.0.1:端口", bool(re.match(r"http://127\.0\.0\.1:\d+$", agent)), agent)
status, body = (None, {})
if agent:
    status, body = http_json(agent + "/status", cfg.get("token"))
check("/status 带 token 能读", status == 200 and body.get("ok") is True, (status, body))
check("代理报告的版本正确", body.get("version") == "0.1.1", body.get("version"))
check("初始没有待安装包", body.get("staged") == [], body.get("staged"))

print()
print("④ 安全边界 …")
status, body = http_json(agent + "/status")
check("不带 token 被拒（403）", status == 403, status)
status, body = http_json(agent + "/start", cfg.get("token"),
                         {"url": "https://evil.example/x.zip", "name": "x.zip"})
check("非白名单域名被拒（400）", status == 400, (status, body))
status, body = http_json(agent + "/start", cfg.get("token"),
                         {"url": "http://github.com/x.zip", "name": "x.zip"})
check("http 明文地址被拒（400）", status == 400, (status, body))

print()
print("⑤ 清理 …")
ok_node = kill_port(PORT)
ag = re.match(r"http://127\.0\.0\.1:(\d+)$", agent or "")
ok_agent = True
if ag:
    ok_agent = kill_port(int(ag.group(1)))
check("程序进程已关闭", ok_node)
check("更新代理已关闭", ok_agent)

print()
print("通过 %d 项，失败 %d 项" % (passed, failed))
sys.exit(0 if failed == 0 else 1)
