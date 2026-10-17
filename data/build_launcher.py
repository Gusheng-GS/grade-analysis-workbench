# -*- coding: utf-8 -*-
"""编译启动器 exe（只编译，不修改源码）。"""
import os
import shutil
import subprocess
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, "DSH成绩分析工作台")
DEV = os.path.join(BASE, "DSH成绩分析工作台-开发文件")
SRC = os.path.join(DEV, "launcher", "Launcher.cs")
EXE = os.path.join(P, "DSH成绩分析工作台.exe")
BAK = os.path.join(DEV, "launcher", "DSH成绩分析工作台.exe.bak")

# 源码必须是 UTF-8 BOM（csc 靠它认编码，否则中文注释会乱码）
raw = open(SRC, "rb").read()
if not raw.startswith(b"\xef\xbb\xbf"):
    open(SRC, "wb").write(b"\xef\xbb\xbf" + raw)
    print("已补 UTF-8 BOM")
else:
    print("源码 BOM: OK")

try:
    src_text = raw.decode("utf-8-sig")
except UnicodeDecodeError as e:
    raise SystemExit("源码不是 UTF-8：%s" % e)

# 静态自检：确认不会再有写死的 app 路径
for bad in ('Path.Combine(baseDir, "app", "node_modules"',
            'IntegrateWorkbench(baseDir);'):
    if bad in src_text:
        raise SystemExit("源码里仍有写死的 app 路径：%s" % bad)
print("静态自检: 无写死的 app 路径 OK")

fw = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319"
csc = os.path.join(fw, "csc.exe")

if os.path.exists(EXE):
    shutil.copy2(EXE, BAK)
    print("已备份旧 exe -> %s (%.1f KB)" % (os.path.basename(BAK), os.path.getsize(BAK) / 1024))

cmd = [
    csc, "/nologo", "/target:winexe", "/codepage:65001", "/utf8output",
    "/out:" + EXE,
    "/reference:" + os.path.join(fw, "System.dll"),
    "/reference:" + os.path.join(fw, "System.Windows.Forms.dll"),
    "/reference:" + os.path.join(fw, "System.Drawing.dll"),
    "/reference:" + os.path.join(fw, "System.IO.Compression.dll"),
    "/reference:" + os.path.join(fw, "System.IO.Compression.FileSystem.dll"),
    SRC,
]
r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
print("编译退出码:", r.returncode)
if r.stdout.strip():
    print(r.stdout.strip()[:1500])
if r.stderr.strip():
    print("stderr:", r.stderr.strip()[:1500])

if r.returncode == 0 and os.path.exists(EXE):
    print("exe 大小: %.1f KB  修改时间 %s" % (
        os.path.getsize(EXE) / 1024, time.strftime('%H:%M:%S', time.localtime(os.path.getmtime(EXE)))))
else:
    raise SystemExit("编译失败")
