# -*- coding: utf-8 -*-
"""
测试"只更新页面"的小更新包能不能生效（这是最容易静默失效的一条路）。

背景（踩过的坑）：
  启动器安装更新时，会从 update\\_workbench.html 复制一份到前端目录。
  如果更新包里带了新页面，但没有同步回 update\\，那 IntegrateWorkbench 就会
  拿**旧的** update\\_workbench.html 把刚装进去的新页面覆盖回去 ——
  表现为"提示更新完成，但界面还是老样子"。

这个测试就是盯这一条：包里只放页面 + 使用说明，跑完后
  · update\\_workbench.html 应该是新版
  · 前端 dist\\_workbench.html 应该是新版（没被覆盖回去）
  · 使用说明.txt 应该是新版
  · index.html 仍然完成了工作台注入
"""
import os
import shutil
import subprocess
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
EXE = os.path.join(P, "DSH成绩分析工作台.exe")
DIST = os.path.join("node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")

SB = os.path.join(ROOT, "_backup", "updatetest-page-" + time.strftime("%Y%m%d-%H%M%S"))

OLD_PAGE = "<!doctype html><html><head><title>工作台</title></head><body>OLD_PAGE_MARKER</body></html>"
NEW_PAGE = "<!doctype html><html><head><title>工作台</title></head><body>NEW_PAGE_MARKER</body></html>"
STOCK_INDEX = "<!doctype html><html><head><title>DSH</title></head><body><div id=app>STOCK</div></body></html>"
OLD_DOC = "旧的使用说明 OLD_DOC_MARKER"
NEW_DOC = "新的使用说明 NEW_DOC_MARKER"

fails = []


def check(label, cond, extra=""):
    print("%s %s %s" % ("[OK]  " if cond else "[FAIL]", label, extra))
    if not cond:
        fails.append(label)


# ── 搭沙箱 ──
app_dir = os.path.join(SB, "app-0.2.1")
os.makedirs(os.path.join(app_dir, DIST), exist_ok=True)
os.makedirs(os.path.join(app_dir, "node_modules", "@deepseek-ai", "dsh", "lib"), exist_ok=True)
open(os.path.join(app_dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), "w").write("// fake\n")
open(os.path.join(app_dir, DIST, "index.html"), "w", encoding="utf-8").write(STOCK_INDEX)
open(os.path.join(app_dir, DIST, "_workbench.html"), "w", encoding="utf-8").write(OLD_PAGE)
open(os.path.join(SB, "使用说明.txt"), "w", encoding="utf-8").write(OLD_DOC)

upd = os.path.join(SB, "update")
os.makedirs(upd, exist_ok=True)
open(os.path.join(upd, "_workbench.html"), "w", encoding="utf-8").write(OLD_PAGE)

# 更新包：只有新页面 + 使用说明（模拟"改了点界面"的小包）
zip_path = os.path.join(upd, "pkg.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("app/" + DIST.replace("\\", "/") + "/_workbench.html", NEW_PAGE)
    z.writestr("_delivery/使用说明.txt", NEW_DOC)

shutil.copy2(EXE, os.path.join(SB, "DSH成绩分析工作台.exe"))
print("沙箱:", SB)
print("更新包内容: app/.../dist/_workbench.html（新版页面）、_delivery/使用说明.txt（新说明）")
print()

# ── 跑 exe ──
proc = subprocess.Popen([os.path.join(SB, "DSH成绩分析工作台.exe")], cwd=SB)
log = os.path.join(SB, "_开发文件", "启动日志.txt")
done = False
deadline = time.time() + 60
while time.time() < deadline:
    if os.path.exists(log):
        t = open(log, encoding="utf-8", errors="replace").read()
        if "=== 更新完成" in t:
            done = True
            break
    if proc.poll() is not None:
        break
    time.sleep(0.5)
time.sleep(0.5)
try:
    proc.kill()
except Exception:
    pass

print("--- 启动日志 ---")
print(open(log, encoding="utf-8", errors="replace").read().strip() if os.path.exists(log) else "(无日志)")
print()

# ── 断言 ──
upd_page = os.path.join(upd, "_workbench.html")
dist_page = os.path.join(app_dir, DIST, "_workbench.html")
dist_index = os.path.join(app_dir, DIST, "index.html")
doc = os.path.join(SB, "使用说明.txt")

check("更新流程跑完", done)
check("update\\_workbench.html 变成新版", "NEW_PAGE_MARKER" in open(upd_page, encoding="utf-8").read())
check("前端页面是新版（没被旧 update 覆盖回去）",
      "NEW_PAGE_MARKER" in open(dist_page, encoding="utf-8").read())
check("使用说明.txt 变成新版", "NEW_DOC_MARKER" in open(doc, encoding="utf-8").read())
check("index.html 完成了工作台注入", "workbench-layer" in open(dist_index, encoding="utf-8").read())
check("zip 已清理", not os.path.exists(zip_path))
check("_stage 已清理", not os.path.exists(os.path.join(upd, "_stage")))

print()
print("沙箱保留在:", SB)
if fails:
    print("!! 失败项:", fails)
    sys.exit(1)
print("===== 只更新页面的小包测试通过 =====")
