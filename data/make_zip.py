# -*- coding: utf-8 -*-
"""
打包交付 zip。

要点：
  · zip 里以 DSH成绩分析工作台\\ 为根，老师解压出来就是一个完整文件夹
  · 中文文件名用 UTF-8（zipfile 会自动打 EFS 标记），Windows 资源管理器能正常解压
  · 打完立刻自检：条目数、关键文件、中文名、以及 zip 里头那份工作台页面不含真名
"""
import hashlib
import json
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
NAME = os.path.basename(P)
OUT = os.path.join(ROOT, "%s-完整包-%s.zip" % (NAME, time.strftime("%Y%m%d")))

with open(os.path.join(ROOT, "data", "home_data.json"), encoding="utf-8") as f:
    names = [s["姓名"] for s in json.load(f)["学生"]]


def longpath(p):
    """node_modules 里有文件全路径超 260，不加 \\\\?\\ 前缀会读不到、也打不进 zip。"""
    ap = os.path.abspath(p)
    if os.name == "nt" and not ap.startswith("\\\\?\\"):
        return "\\\\?\\" + ap
    return ap


# 收集文件（先看那个 >8MB 的文本文件是什么）
files = []
big_text = []
TEXT_EXT = (".html", ".js", ".json", ".txt", ".bat", ".css", ".map", ".md", ".yml", ".yaml")
for r, d, fs in os.walk(P):
    for f in fs:
        p = os.path.join(r, f)
        files.append(p)
        if os.path.splitext(f)[1].lower() in TEXT_EXT and os.path.getsize(longpath(p)) > 8 * 1024 * 1024:
            big_text.append(p)
print("待打包文件数: %d" % len(files))
for p in big_text:
    print("  大文本文件(>8MB): %s  %.1f MB" % (os.path.relpath(p, P), os.path.getsize(longpath(p)) / 1048576))
    t = None
    for enc in ("utf-8", "gbk"):
        try:
            t = open(longpath(p), "rb").read().decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if t:
        hit = [n for n in names if n in t]
        print("    含学生真名:", hit if hit else "无")
        if hit:
            sys.exit("!! 这个大文件里含真名，停止打包")

if os.path.exists(OUT):
    os.remove(OUT)

print()
print("正在压缩 → %s" % OUT)
t0 = time.time()
total = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for i, p in enumerate(files, 1):
        arc = os.path.join(NAME, os.path.relpath(p, P))
        z.write(longpath(p), arc)
        total += os.path.getsize(longpath(p))
        if i % 5000 == 0:
            print("  已写入 %d/%d 个文件（%.0f 秒）" % (i, len(files), time.time() - t0))
dt = time.time() - t0
print("压缩完成：%d 个文件，原始 %.1f MB → zip %.1f MB，用时 %.0f 秒"
      % (len(files), total / 1048576, os.path.getsize(OUT) / 1048576, dt))

print()
print("===== 自检 =====")
bad = []
with zipfile.ZipFile(OUT) as z:
    entries = z.namelist()
    print("  zip 内条目数: %d（文件夹里 %d 个文件）" % (len(entries), len(files)))
    if len(entries) != len(files):
        bad.append("条目数与文件数不一致")
    need = [
        NAME + "/启动.bat", NAME + "/停止.bat", NAME + "/使用说明.txt",
        NAME + "/DSH成绩分析工作台.exe", NAME + "/runtime/node.exe",
        NAME + "/update/_workbench.html", NAME + "/update/xlsx.full.min.js",
        NAME + "/app-0.2.1/node_modules/@deepseek-ai/dsh/lib/bin.js",
    ]
    for n in need:
        exists = n in entries
        print("  %s %s" % ("[OK]  " if exists else "[!!]  ", n))
        if not exists:
            bad.append("缺少 " + n)
    # 中文名能不能正确还原
    if not any("启动.bat" in e for e in entries):
        bad.append("中文文件名没有正确写入")
    # zip 里那份工作台页面
    page = z.read(NAME + "/update/_workbench.html").decode("utf-8")
    leak = [n for n in names if n in page]
    print("  %s zip 里的工作台页面不含学生真名" % ("[OK]  " if not leak else "[!!]  "))
    if leak:
        bad.append("zip 内页面含真名: %s" % leak[:3])
    if "var WuyueParse" not in page:
        bad.append("zip 内页面缺少解析器")
    if "还没有成绩数据" not in page:
        bad.append("zip 内页面缺少空状态引导")

print()
if bad:
    print("!! 自检不通过：")
    for b in bad:
        print("   -", b)
    sys.exit(1)
print("===== 打包完成并通过自检 =====")
print("交付文件: %s" % OUT)
