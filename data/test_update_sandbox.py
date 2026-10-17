# -*- coding: utf-8 -*-
"""
沙箱测试启动器的"更新"路径（这是我刚改过的代码）。

为什么要沙箱：真实更新会覆盖 476MB 的 app-0.2.1，风险不值得冒。
沙箱里只放假文件，验证三件事：
  ① 更新包被解压并覆盖到 **探测到的程序目录**（app-0.2.1，不是写死的 app）
  ② 覆盖后 index.html 被重新注入工作台（含 workbench-layer）
  ③ _workbench.html 被部署，且 zip 与 _stage 被清理
"""
import hashlib
import os
import shutil
import subprocess
import sys
import time
import zipfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, "DSH成绩分析工作台")
DIST = os.path.join("node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")
DSH = os.path.join("node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")

SB = os.path.join(BASE, "_backup", "updatetest-" + time.strftime("%Y%m%d-%H%M%S"))
EXE = os.path.join(P, "DSH成绩分析工作台.exe")
WB = os.path.join(P, "update", "_workbench.html")

NEW_INDEX = ("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>DSH</title></head>\n"
             "<body><div id=\"app\">NEWVERSION-0.3.0</div></body></html>\n")
OLD_INDEX = ("<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>DSH</title></head>\n"
             "<body><div id=\"app\">OLDVERSION-0.2.1</div></body></html>\n")

os.makedirs(SB, exist_ok=True)

# ── 搭沙箱 ──
app_dir = os.path.join(SB, "app-0.2.1")
os.makedirs(os.path.join(app_dir, DIST), exist_ok=True)
os.makedirs(os.path.join(app_dir, os.path.dirname(DSH)), exist_ok=True)
open(os.path.join(app_dir, DSH), "w", encoding="utf-8").write("// fake dsh entry\n")
open(os.path.join(app_dir, DIST, "index.html"), "w", encoding="utf-8").write(OLD_INDEX)

upd = os.path.join(SB, "update")
os.makedirs(upd, exist_ok=True)
shutil.copy2(WB, os.path.join(upd, "_workbench.html"))
# 交付包里还有 SheetJS（导入成绩用），更新时也要一起部署到前端目录
shutil.copy2(os.path.join(P, "update", "xlsx.full.min.js"), os.path.join(upd, "xlsx.full.min.js"))

zip_path = os.path.join(upd, "pkg.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    info = zipfile.ZipInfo("app/" + DIST.replace("\\", "/") + "/index.html")
    z.writestr(info, NEW_INDEX)
    z.writestr("app/" + DSH.replace("\\", "/"), "// fake dsh entry NEW\n")

shutil.copy2(EXE, os.path.join(SB, "DSH成绩分析工作台.exe"))
print("沙箱:", SB)

# ── 跑 exe（更新完成后会弹一个"更新完成"提示框，测试里直接杀掉进程）──
proc = subprocess.Popen([os.path.join(SB, "DSH成绩分析工作台.exe")], cwd=SB)
log = os.path.join(SB, "_开发文件", "启动日志.txt")

deadline = time.time() + 60
done = False
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

print()
print("--- 启动日志 ---")
print(open(log, encoding="utf-8", errors="replace").read().strip() if os.path.exists(log) else "(无日志)")
print()

# ── 断言 ──
fails = []


def check(label, cond, extra=""):
    print("%s %s %s" % ("[OK]  " if cond else "[FAIL]", label, extra))
    if not cond:
        fails.append(label)


idx = os.path.join(app_dir, DIST, "index.html")
tpl = os.path.join(app_dir, DIST, "index.dsh-original.html")
wbdst = os.path.join(app_dir, DIST, "_workbench.html")

check("更新流程跑完", done)
idx_txt = open(idx, encoding="utf-8").read() if os.path.exists(idx) else ""
check("新版本内容已覆盖 (NEWVERSION)", "NEWVERSION" in idx_txt)
check("工作台已重新注入 (workbench-layer)", "workbench-layer" in idx_txt)
check("原版模板已留存", os.path.exists(tpl))
check("_workbench.html 已部署", os.path.exists(wbdst),
      "(%d bytes)" % os.path.getsize(wbdst) if os.path.exists(wbdst) else "")
if os.path.exists(wbdst):
    same = hashlib.md5(open(wbdst, "rb").read()).hexdigest() == hashlib.md5(open(WB, "rb").read()).hexdigest()
    check("部署的工作台页面与交付包一致", same)
check("zip 已清理", not os.path.exists(zip_path))
check("_stage 已清理", not os.path.exists(os.path.join(upd, "_stage")))
check("没有误动沙箱外的 app 目录", not os.path.exists(os.path.join(P, "app")))
xlsx_dst = os.path.join(app_dir, DIST, "xlsx.full.min.js")
check("xlsx 解析库已部署", os.path.exists(xlsx_dst),
      "(%d bytes)" % os.path.getsize(xlsx_dst) if os.path.exists(xlsx_dst) else "")

print()
print("沙箱保留在:", SB)
if fails:
    print("!! 失败项:", fails)
    sys.exit(1)
print("===== 更新路径测试通过 =====")
