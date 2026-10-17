# -*- coding: utf-8 -*-
"""
打一个"小更新包"：只装这次改动过的几个文件，让老师复制覆盖旧文件夹。

为什么要单独做这个：这次改动落在工作台页面上，而页面文件在前端 dist 目录里。
老师手上那份启动器是**旧版**，它的更新逻辑会把 dist 里的页面用
update\\_workbench.html 覆盖回去 —— 也就是说，光靠"把 zip 放进 update\\"
这条路，这次改的东西装不上。所以这一轮要么发完整包，要么让老师手工覆盖这几个文件。

包里带的文件（其余一概不动）：
  DSH成绩分析工作台.exe                    启动器（顺手修好上面那个覆盖问题）
  使用说明.txt                              更新后的说明
  app-0.2.1/.../dist/_workbench.html        新工作台页面
  app-0.2.1/.../dist/index.html             重新注入过的入口（带新的 ?v=，避免旧缓存）
  update/_workbench.html                    同步一份，保持文件夹内部一致
  update/xlsx.full.min.js                   解析库（没变，但保证存在）
"""
import hashlib
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
DIST = os.path.join("app-0.2.1", "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")
OUT = os.path.join(ROOT, "更新包-工作台页面与说明-%s.zip" % time.strftime("%Y%m%d"))

FILES = [
    "DSH成绩分析工作台.exe",
    "使用说明.txt",
    os.path.join(DIST, "_workbench.html"),
    os.path.join(DIST, "index.html"),
    os.path.join("update", "_workbench.html"),
    os.path.join("update", "xlsx.full.min.js"),
]

HOWTO = """\
怎么安装这次更新
================================================================

  这次只改了界面和说明书，不用重新下载整个程序。

  第 1 步　先关掉正在运行的程序
      双击你程序文件夹里的「停止.bat」

  第 2 步　把本文件夹里的东西复制过去
      1) 打开这个解压出来的文件夹
      2) 选中下面这几项（不要选「怎么更新.txt」）：
           使用说明.txt
           DSH成绩分析工作台.exe
           app-0.2.1
           update
      3) 右键 → 复制
      4) 打开你原来的「DSH成绩分析工作台」文件夹，右键 → 粘贴
      5) 弹出"目标中已有同名文件"时，选「替换目标中的文件」

  第 3 步　重新打开
      双击「启动.bat」。
      第一次请按 Ctrl + F5 强制刷新一次浏览器（避免看到旧缓存）。

  ────────────────────────────────────────────────
  成绩和 API 密钥存在浏览器里，这次更新不会动它们；
  已经生成过的方案也还在。
================================================================
"""

if not os.path.exists(os.path.join(P, "DSH成绩分析工作台.exe")):
    sys.exit("找不到交付文件夹，先确认路径")

fails = []
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in FILES:
        src = os.path.join(P, rel)
        if not os.path.exists(src):
            fails.append("缺文件: " + rel)
            continue
        z.write(src, rel.replace("\\", "/"))
    z.writestr("怎么更新.txt", HOWTO.encode("utf-8"))

if fails:
    print("!! 有问题：", fails)
    sys.exit(1)

print("已生成小更新包: %s" % OUT)
print("  大小: %.0f KB" % (os.path.getsize(OUT) / 1024))
print("  内容:")
with zipfile.ZipFile(OUT) as z:
    for i in z.infolist():
        print("    %-70s %8.1f KB" % (i.filename, i.file_size / 1024))
    # 自检：包里的文件必须和交付文件夹里的字节一致
    bad = []
    for rel in FILES:
        src = os.path.join(P, rel)
        a = hashlib.md5(open(src, "rb").read()).hexdigest()
        b = hashlib.md5(z.read(rel.replace("\\", "/"))).hexdigest()
        if a != b:
            bad.append(rel)
    print()
    if bad:
        print("!! 包内文件与交付文件夹不一致:", bad)
        sys.exit(1)
    print("  自检: 包内 %d 个文件与交付文件夹字节一致" % len(FILES))
print()
print("注意：这个包要手工复制覆盖（老师手上那版启动器还不会装页面类更新）。")
print("      想省事的话，直接发完整包更简单。")
