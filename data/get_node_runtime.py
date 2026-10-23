# -*- coding: utf-8 -*-
"""
从 nodejs.org 官方源取 Windows x64 运行环境，并用官方 SHASUMS256.txt 校验。

为什么不用最新版 26.x：26 是 Current（非 LTS），我们外壳与依赖都在 24 线上验证过。
安全修复已经 backport 到 24 的 LTS 补丁版，所以留在 LTS 线上、升到最新补丁版即可。

用法：
    python data/get_node_runtime.py                 # 默认取脚本里的 TARGET
    python data/get_node_runtime.py --version v24.22.1
"""
import argparse
import hashlib
import io
import os
import shutil
import sys
import urllib.request
import zipfile

TARGET = "v24.22.1"
ROOT = r"D:\01_Projects\Python_Projects\Student_Performance_Tracking_Dashboard"
TMP = os.path.join(ROOT, "build", "_node_dl")
UA = {"User-Agent": "grade-workbench-runtime-updater"}

ap = argparse.ArgumentParser()
ap.add_argument("--version", default=TARGET)
ap.add_argument("--apply", action="store_true", help="校验通过后直接替换交付包里的 node.exe")
args = ap.parse_args()

ver = args.version if args.version.startswith("v") else "v" + args.version
base = "https://nodejs.org/dist/%s/" % ver
zipname = "node-%s-win-x64.zip" % ver

os.makedirs(TMP, exist_ok=True)


def fetch(url, what):
    print("  下载 %s …" % what, end="", flush=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    print(" %.0f KB" % (len(data) / 1024))
    return data


print("① 取官方校验和 SHASUMS256.txt")
shasums = fetch(base + "SHASUMS256.txt", "SHASUMS256.txt").decode("utf-8", "replace")
want = None
for line in shasums.splitlines():
    parts = line.split()
    if len(parts) == 2 and parts[1] == zipname:
        want = parts[0]
        break
if not want:
    raise SystemExit("SHASUMS 里找不到 %s" % zipname)
print("  官方 SHA-256: %s" % want)

print("② 下载 %s" % zipname)
blob = fetch(base + zipname, zipname)
got = hashlib.sha256(blob).hexdigest()
if got != want:
    raise SystemExit("!! 校验失败：%s != %s" % (got, want))
print("  SHA-256 校验通过 ✅")

print("③ 解出 node.exe")
zp = os.path.join(TMP, zipname)
io.open(zp, "wb").write(blob)
exe_tmp = os.path.join(TMP, "node.exe")
with zipfile.ZipFile(zp) as z:
    name = [n for n in z.namelist() if n.endswith("/node.exe") or n == "node.exe"][0]
    with z.open(name) as s, open(exe_tmp, "wb") as o:
        shutil.copyfileobj(s, o)
print("  %s → %.1f MB" % (name, os.path.getsize(exe_tmp) / 1048576))

import subprocess
out = subprocess.run([exe_tmp, "--version"], capture_output=True, text=True).stdout.strip()
print("  新 node 版本: %s" % out)
if out != ver:
    raise SystemExit("!! 版本对不上：%s != %s" % (out, ver))

if args.apply:
    dst = os.path.join(ROOT, "DSH成绩分析工作台", "runtime", "node.exe")
    bak = os.path.join(ROOT, "历史版本", "备份", "node.exe.%s.bak" % ver)
    os.makedirs(os.path.dirname(bak), exist_ok=True)
    if os.path.exists(dst):
        shutil.copy2(dst, bak)
        print("  旧 runtime 已备份: %s" % os.path.basename(bak))
    shutil.copyfile(exe_tmp, dst)
    print("  已替换: DSH成绩分析工作台\\runtime\\node.exe")
else:
    print("  （只是下载校验；加 --apply 才会替换交付包里的 node.exe）")
