# -*- coding: utf-8 -*-
"""
把生成好的工作台页面 + 依赖，同步到交付物里（可反复执行）。

同步三处，保证完全一致：
  ① 项目根 成绩分析工作台-首页.html        （源文件 + 双击预览用）
  ② 交付包 update\\_workbench.html          （启动器安装更新时用它重新注入）
  ③ app-0.2.1 前端 dist\\_workbench.html    （真正被浏览器加载的那份）

另外把 SheetJS（读 xlsx 用）也放到位：
  ./xlsx.full.min.js 必须和 _workbench.html 同目录，否则"导入成绩"只能靠 CDN。
"""
import hashlib
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "成绩分析工作台-首页.html")
P = os.path.join(ROOT, "DSH成绩分析工作台")
DIST = os.path.join(P, "app-0.2.1", "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")
VENDOR_SRC = os.path.join(ROOT, "_devtools", "node_modules", "xlsx", "dist", "xlsx.full.min.js")


def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


def copy(src, dst, label):
    if not os.path.exists(src):
        sys.exit("缺少源文件: %s" % src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print("  %-34s %8.1f KB  md5=%s" % (label, os.path.getsize(dst) / 1024, md5(dst)[:10]))


print("① 同步工作台页面")
targets = [
    (os.path.join(P, "update", "_workbench.html"), "交付包 update\\_workbench.html"),
    (os.path.join(DIST, "_workbench.html"), "app-0.2.1 前端 dist\\_workbench.html"),
]
for dst, label in targets:
    copy(PAGE, dst, label)

src_md5 = md5(PAGE)
for dst, label in targets:
    if md5(dst) != src_md5:
        sys.exit("不一致：%s" % label)
print("  三份 md5 一致: %s" % src_md5[:10])

print()
print("② 同步 SheetJS（导入 xlsx 用，避免依赖 CDN）")
if not os.path.exists(VENDOR_SRC):
    sys.exit("找不到 %s\n请先在 _devtools 里 npm install xlsx@0.18.5" % VENDOR_SRC)
copy(VENDOR_SRC, os.path.join(ROOT, "xlsx.full.min.js"), "项目根 xlsx.full.min.js")
copy(VENDOR_SRC, os.path.join(P, "update", "xlsx.full.min.js"), "交付包 update\\xlsx.full.min.js")
copy(VENDOR_SRC, os.path.join(DIST, "xlsx.full.min.js"), "app-0.2.1 dist\\xlsx.full.min.js")

print()
print("===== 同步完成 =====")
