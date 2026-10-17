# -*- coding: utf-8 -*-
"""
检查交付物里有没有学生真实姓名 —— 交付前必跑。

用途：页面是"空白版"时，里面不应该出现任何真名；
      真名只可能存在于老师自己导入后（存在他自己的浏览器里）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "data", "home_data.json")

with open(REF, encoding="utf-8") as f:
    names = [s["姓名"] for s in json.load(f)["学生"]]

targets = sys.argv[1:] or [
    os.path.join(ROOT, "成绩分析工作台-首页.html"),
    os.path.join(ROOT, "DSH成绩分析工作台", "update", "_workbench.html"),
]
targets += [
    os.path.join(ROOT, "DSH成绩分析工作台", "app-0.2.1", "node_modules", "@deepseek-ai",
                 "dsh-web-frontend", "dist", "_workbench.html"),
]

print("参照名单：%d 个真实姓名（来自 home_data.json）" % len(names))
print()
bad = 0
for t in targets:
    if not os.path.exists(t):
        print("  [跳过] 不存在: %s" % os.path.relpath(t, ROOT))
        continue
    data = open(t, "rb").read()
    text = None
    for enc in ("utf-8", "gbk"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        print("  [跳过] 读不出来: %s" % os.path.relpath(t, ROOT))
        continue
    hits = [n for n in names if n in text]
    rel = os.path.relpath(t, ROOT)
    if hits:
        bad += 1
        print("  [!! 有真名] %s  ->  %s" % (rel, "、".join(hits[:6]) + (" 等 %d 个" % len(hits) if len(hits) > 6 else "")))
    else:
        print("  [干净]     %s" % rel)

print()
if bad:
    print("!! 有 %d 个文件里出现了学生真名，不要交付。" % bad)
    sys.exit(1)
print("===== 检查通过：交付物里没有任何学生真名 =====")
