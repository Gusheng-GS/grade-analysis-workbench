# -*- coding: utf-8 -*-
"""
扫描交付包里 node_modules 的开源协议，按协议归类，并挑出"有约束"的。

为什么需要：交付包是把 DSH + 它的全部依赖一起打包给老师的。
一旦要开源自己的项目、或者对外分发这个包，就得知道自己到底在分发什么协议的东西。
只读分析，不改任何东西。

用法：
    python data\\scan_licenses.py                      扫交付包里的依赖
    python data\\scan_licenses.py <某个 node_modules 路径>
"""
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, "DSH成绩分析工作台", "app-0.2.1", "node_modules")

TARGET = sys.argv[1] if len(sys.argv) > 1 else DEFAULT

# 宽松（可以自由使用、修改、再分发，只需保留版权声明）
PERMISSIVE = {
    "MIT", "MIT-0", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
    "0BSD", "Unlicense", "CC0-1.0", "Python-2.0", "Zlib", "WTFPL",
    "BlueOak-1.0.0", "MIT/X11", "Apache 2.0", "BSD", "Public Domain",
}
# 有约束（需要额外注意，甚至可能影响你项目的授权选择）
COPYLEFT = {"GPL", "GPL-2.0", "GPL-3.0", "AGPL", "AGPL-3.0", "LGPL", "LGPL-2.1",
            "LGPL-3.0", "MPL", "MPL-2.0", "EPL", "EPL-2.0", "CDDL", "SSPL"}
# 非商业 / 特殊限制
RESTRICTED = {"CC-BY-NC", "CC-BY-NC-SA", "CC-BY-NC-ND", "BUSL", "Elastic", "UNLICENSED", "Proprietary"}


def read_license_file(pkg_dir):
    """没有 license 字段时，从 LICENSE 文件正文猜协议。"""
    for n in os.listdir(pkg_dir) if os.path.isdir(pkg_dir) else []:
        low = n.lower()
        if low.startswith(("license", "licence", "copying", "notice")):
            p = os.path.join(pkg_dir, n)
            if not os.path.isfile(p) or os.path.getsize(p) > 200000:
                continue
            try:
                t = open(p, encoding="utf-8", errors="ignore").read(4000)
            except OSError:
                continue
            tl = t.lower()
            if "gnu affero" in tl:
                return "AGPL(文件)"
            if "gnu lesser" in tl:
                return "LGPL(文件)"
            if "gnu general public" in tl:
                return "GPL(文件)"
            if "mozilla public license" in tl:
                return "MPL(文件)"
            if "apache license" in tl:
                return "Apache-2.0(文件)"
            if "mit license" in tl or "permission is hereby granted, free of charge" in tl:
                return "MIT(文件)"
            if "isc license" in tl or "permission to use, copy, modify" in tl:
                return "ISC(文件)"
            if "bsd" in tl:
                return "BSD(文件)"
    return None


def scan(root):
    pkgs = []
    seen = set()
    for base in (root, os.path.join(root, "@deepseek-ai")):
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.listdir(base)):
            d = os.path.join(base, entry)
            if entry.startswith("@"):
                continue
            pj = os.path.join(d, "package.json")
            if not os.path.isfile(pj):
                continue
            real = os.path.realpath(d)
            if real in seen:
                continue
            seen.add(real)
            try:
                j = json.load(open(pj, encoding="utf-8"))
            except Exception:
                continue
            lic = j.get("license")
            if isinstance(lic, dict):
                lic = lic.get("type")
            if not lic and j.get("licenses"):
                ls = j["licenses"]
                lic = ls[0].get("type") if isinstance(ls, list) and ls and isinstance(ls[0], dict) else str(ls)
            lic = (lic or "").strip() or None
            if not lic:
                lic = read_license_file(d) or "（未标注）"
            pkgs.append({
                "name": j.get("name") or entry,
                "version": j.get("version") or "?",
                "license": lic,
                "dir": os.path.relpath(d, root),
            })
    return pkgs


print("扫描目录:", TARGET)
pkgs = scan(TARGET)
print("包数量:", len(pkgs))
print()

def bucket(lic):
    l = re.sub(r"\(文件\)$", "", lic)
    if l in RESTRICTED or any(l.startswith(x) for x in RESTRICTED):
        return "restricted"
    if l in COPYLEFT or any(l.startswith(x) for x in COPYLEFT):
        return "copyleft"
    if l in PERMISSIVE or any(l.startswith(x) for x in PERMISSIVE):
        return "permissive"
    if l == "（未标注）":
        return "unknown"
    return "other"


groups = defaultdict(list)
for p in pkgs:
    groups[bucket(p["license"])].append(p)

order = [("restricted", "⚠ 有特殊限制"), ("copyleft", "⚠ 传染性/弱传染（要留意）"),
         ("unknown", "⚠ 没标注协议"), ("other", "其它（需人工看）"),
         ("permissive", "✅ 宽松协议")]
for key, title in order:
    items = groups.get(key) or []
    if not items:
        continue
    print("=== %s：%d 个 ===" % (title, len(items)))
    if key == "permissive":
        cnt = defaultdict(int)
        for it in items:
            cnt[re.sub(r"\(文件\)$", "", it["license"])] += 1
        for lic, n in sorted(cnt.items(), key=lambda x: -x[1]):
            print("   %-22s %d 个包" % (lic, n))
    else:
        for it in items:
            print("   %-34s %-14s %s" % (it["name"][:34], it["license"], it["version"]))
    print()

print("=== 汇总 ===")
for key, title in order:
    print("   %-28s %d" % (title, len(groups.get(key) or [])))
