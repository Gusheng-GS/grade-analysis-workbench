# -*- coding: utf-8 -*-
"""
交付前体检：把整个「DSH成绩分析工作台」文件夹按交付标准过一遍。

检查项：
  ① 结构：该有的文件都在，不该有的（data-0.2.1 / _开发文件 / 临时文件）都不在
  ② 真名：整个交付文件夹里不出现任何学生真实姓名（遍历所有文本类文件）
  ③ 页面：内置数据是空的、带解析器、本地优先加载 xlsx
  ④ 脚本：两个 bat 是 GBK + CRLF + chcp 936；说明书是 UTF-8 BOM
  ⑤ 依赖：update\\ 里 _workbench.html 与 xlsx.full.min.js 都在且与源一致
"""
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
DIST = os.path.join(P, "app-0.2.1", "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")
REF = os.path.join(ROOT, "data", "home_data.json")

fails = []
warns = []


def ok(label, cond, extra=""):
    print("  %s %s%s" % ("[OK]  " if cond else "[!!]  ", label, ("  " + extra) if extra else ""))
    if not cond:
        fails.append(label)


def warn(label, cond, extra=""):
    if not cond:
        print("  [警告] %s%s" % (label, ("  " + extra) if extra else ""))
        warns.append(label)


def md5(p):
    return hashlib.md5(open(longpath(p), "rb").read()).hexdigest()


def longpath(p):
    """Windows 长路径前缀。

    node_modules 里有几个文件的全路径超过 260，普通 open() 会直接失败 ——
    之前体检里那些文件是被静默跳过的（"没扫到"被当成了"没问题"）。
    加上 \\\\?\\ 前缀才能真的读到它们。
    """
    ap = os.path.abspath(p)
    if os.name == "nt" and not ap.startswith("\\\\?\\"):
        return "\\\\?\\" + ap
    return ap


print("=" * 72)
print("交付前体检")
print("=" * 72)

print("\n① 结构")
must = ["DSH成绩分析工作台.exe", "启动.bat", "停止.bat", "使用说明.txt",
        "app-0.2.1", "runtime", "update"]
for n in must:
    ok("存在 %s" % n, os.path.exists(os.path.join(P, n)))
should_not = ["data-0.2.1", "_开发文件", "启动日志.txt"]
for n in should_not:
    ok("交付前不应存在 %s（首次运行才生成）" % n, not os.path.exists(os.path.join(P, n)))
n_root = sorted(os.listdir(P))
ok("根目录没有多余文件", set(n_root) <= set(must), "实际: " + "、".join(n_root))
upd = sorted(os.listdir(os.path.join(P, "update")))
ok("update\\ 内容正确", upd == ["_workbench.html", "xlsx.full.min.js"], "实际: " + "、".join(upd))

print("\n② 学生真名（遍历整个交付文件夹的文本文件）")
with open(REF, encoding="utf-8") as f:
    names = [s["姓名"] for s in json.load(f)["学生"]]
TEXT_EXT = (".html", ".htm", ".js", ".mjs", ".cjs", ".json", ".txt", ".bat", ".cmd", ".md",
            ".yml", ".yaml", ".css", ".map", ".xml", ".ts")
scanned = 0
skipped_big = 0
unreadable = []
leak_files = []
for r, d, fs in os.walk(P):
    for f in fs:
        ext = os.path.splitext(f)[1].lower()
        if ext not in TEXT_EXT:
            continue
        p = os.path.join(r, f)
        try:
            if os.path.getsize(longpath(p)) > 8 * 1024 * 1024:
                skipped_big += 1
                continue
            raw = open(longpath(p), "rb").read()
        except OSError as e:
            unreadable.append((os.path.relpath(p, P), e.__class__.__name__))
            continue
        scanned += 1
        for enc in ("utf-8", "gbk"):
            try:
                t = raw.decode(enc)
                break
            except UnicodeDecodeError:
                t = None
        if t is None:
            continue
        hit = [n for n in names if n in t]
        if hit:
            leak_files.append((os.path.relpath(p, P), hit))
print("  扫描了 %d 个文本文件（跳过 %d 个超过 8MB 的，%d 个读不了）"
      % (scanned, skipped_big, len(unreadable)))
for p, why in unreadable[:5]:
    print("     读不了: %s (%s)" % (p[:100], why))
ok("没有读不了的文本文件（否则等于没检查）", not unreadable, "%d 个" % len(unreadable))
warn("没有被跳过的超大文本文件", skipped_big == 0, "%d 个" % skipped_big)
ok("没有任何文件含学生真名", not leak_files,
   "泄漏: " + "、".join("%s(%s)" % (f, h[0]) for f, h in leak_files[:4]) if leak_files else "")

print("\n③ 工作台页面")
page = open(os.path.join(P, "update", "_workbench.html"), encoding="utf-8").read()
import re
m = re.search(r"let DATA = (\{.*?\});\nconst LS_KEY", page, re.S)
inner = json.loads(m.group(1)) if m else None
ok("内置数据为空（不含学生）", bool(inner) and len(inner["学生"]) == 0)
ok("页面内联了解析器 WuyueParse", "var WuyueParse" in page)
ok("本地优先加载 xlsx", "'./xlsx.full.min.js'" in page)
ok("有导入后的持久化键", "dsh-grade-workbench-v6-data" in page)
ok("空状态有引导文案", "还没有成绩数据" in page and "尚未导入成绩" in page)
ok("不再出现『内置演示数据』措辞", "内置演示数据" not in page)

print("\n④ 编码")
for b in ("启动.bat", "停止.bat"):
    raw = open(os.path.join(P, b), "rb").read()
    try:
        t = raw.decode("gbk")
        gbk_ok = True
    except UnicodeDecodeError:
        t, gbk_ok = "", False
    ok("%s 是 GBK" % b, gbk_ok)
    ok("%s 全是 CRLF" % b, raw.count(b"\n") == raw.count(b"\r\n"))
    ok("%s 有 chcp 936" % b, "chcp 936" in t)
doc = open(os.path.join(P, "使用说明.txt"), "rb").read()
ok("使用说明.txt 是 UTF-8 BOM", doc.startswith(b"\xef\xbb\xbf"))
ok("使用说明里有导入步骤", "导入成绩" in doc.decode("utf-8-sig"))

print("\n⑤ 与源文件一致")
src = os.path.join(ROOT, "成绩分析工作台-首页.html")
ok("update\\_workbench.html == 根目录源文件", md5(src) == md5(os.path.join(P, "update", "_workbench.html")))
ok("前端 dist\\_workbench.html == 源文件", md5(src) == md5(os.path.join(DIST, "_workbench.html")))
vendor = os.path.join(ROOT, "xlsx.full.min.js")
ok("update\\xlsx.full.min.js == 源文件", md5(vendor) == md5(os.path.join(P, "update", "xlsx.full.min.js")))
ok("前端 dist\\xlsx.full.min.js == 源文件", md5(vendor) == md5(os.path.join(DIST, "xlsx.full.min.js")))

print("\n⑥ 体积")
def dirsize(p):
    t = 0
    for r, _, fs in os.walk(p):
        for f in fs:
            try:
                t += os.path.getsize(os.path.join(r, f))
            except OSError:
                pass
    return t
total = dirsize(P)
print("  交付文件夹合计 %.1f MB" % (total / 1048576))
warn("总体积在 600MB 以内", total < 600 * 1048576, "%.1f MB" % (total / 1048576))

print()
print("=" * 72)
if fails:
    print("!! 体检不通过，先别交付：")
    for f in fails:
        print("   -", f)
    sys.exit(1)
print("体检通过，可以打包交付。" + ("（%d 条提醒）" % len(warns) if warns else ""))
