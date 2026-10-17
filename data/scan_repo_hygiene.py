# -*- coding: utf-8 -*-
"""
开源前自查：仓库里有哪些东西**不能**跟着公开。

两类：
  ① 学生真实数据（姓名、成绩）—— 涉及未成年人个人信息，公开出去问题很大
  ② 个人/学校标识（微信 wxid、本机路径、学校名）—— 别人能从里面认出你

只读扫描，不改任何文件。

用法： python data\\scan_repo_hygiene.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 第三方代码/依赖目录：这些不是你的代码，扫描时跳过（它们的体积也太大）
SKIP_DIRS = {
    "node_modules", ".git", "_devtools", "dsh-src", "runtime",
    "app", "app-0.2.1", "dist",
}
TEXT_EXT = (".py", ".js", ".mjs", ".json", ".html", ".htm", ".txt", ".md", ".bat", ".cmd",
            ".yml", ".yaml", ".cs", ".docx", ".xml", ".csv", ".log")

# 参照名单：正常情况下就是仓库里那份**合成**样例数据（同学01…同学40）
ref = os.path.join(ROOT, "data", "home_data.json")
names = []
if os.path.exists(ref):
    with open(ref, encoding="utf-8") as f:
        names = [s["姓名"] for s in json.load(f)["学生"]]

# 如果参照名单本身就是合成数据（同学NN），拿它比对姓名没有意义，只保留"个人标识"检查
SYNTHETIC = re.compile(r"^同学\d+$")
synthetic_ref = bool(names) and all(SYNTHETIC.match(n) for n in names)
if synthetic_ref:
    names = []

# 个人标识特征：(标签, 正则, 例外的写法, 是否必须处理)
#   合成数据里的占位符（示例中学 / 2026年09月20日高二09月考 / C:\Users\sample）不算泄漏，
#   但要人工确认它们确实只是占位符
PATTERNS = [
    ("微信文件路径(wxid)", re.compile(r"wxid_[A-Za-z0-9_\-]+"), set(), True),
    ("本机用户目录", re.compile(r"C:\\Users\\[A-Za-z0-9_\-\.]+"), {"C:\\Users\\sample"}, True),
    ("学校名", re.compile(r"示例中学"), set(), False),
    ("考试原始导出目录名", re.compile(r"\d{4}年\d{2}月\d{2}日高二\d{2}月考"), set(), False),
    ("手机号", re.compile(r"\b1[3-9]\d{9}\b"), set(), True),
    ("邮箱", re.compile(r"\b[\w\.\-]+@[\w\-]+\.[a-z]{2,}\b"), set(), True),
]

print("参照名单：%d 个学生姓名%s" % (len(names), "（合成数据，跳过姓名比对）" if synthetic_ref else ""))
print()

hits = {}
scanned = 0
for r, dirs, fs in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in fs:
        if not f.lower().endswith(TEXT_EXT):
            continue
        p = os.path.join(r, f)
        try:
            if os.path.getsize(p) > 12 * 1024 * 1024:
                continue
            raw = open(p, "rb").read()
        except OSError:
            continue
        scanned += 1
        text = None
        for enc in ("utf-8-sig", "utf-8", "gbk"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            text = raw.decode("utf-8", "ignore")
        rel = os.path.relpath(p, ROOT)
        # 学生姓名
        found = [n for n in names if n in text]
        if found:
            hits.setdefault("学生真实姓名", []).append((rel, len(found), "、".join(found[:4]), True))
        # 个人标识
        for label, pat, allow, must in PATTERNS:
            m = [x for x in pat.findall(text) if x not in allow]
            if m:
                uniq = sorted(set(m))[:3]
                hits.setdefault(label, []).append((rel, len(m), "、".join(uniq), must))

print("扫描了 %d 个文本文件" % scanned)
print()
if not hits:
    print("✅ 没有发现学生姓名或个人标识")
else:
    total = 0
    must_total = 0
    for label in ("学生真实姓名", "微信文件路径(wxid)", "本机用户目录", "考试原始导出目录名", "学校名", "手机号", "邮箱"):
        items = hits.get(label)
        if not items:
            continue
        items.sort(key=lambda x: -x[1])
        must = items[0][3]
        print("%s 【%s】出现在 %d 个文件：" % ("⚠" if must else "·", label, len(items)))
        for rel, n, sample, _ in items[:14]:
            print("    %-58s %3d 处  例: %s" % (rel[:58], n, sample[:40]))
        if len(items) > 14:
            print("    ... 另有 %d 个文件" % (len(items) - 14))
        print()
        total += len(items)
        if must:
            must_total += len(items)
    print("合计 %d 处命中" % total)
    print()
    if must_total:
        print("⚠ 其中 %d 处必须处理：这些文件要么删掉、要么用假数据替换后再提交；" % must_total)
        print("  如果已经提交过 git，历史里也会留着，需要用 filter-repo 之类清历史。")
    else:
        print("✅ 没有必须处理的项。· 标记的那些是**合成样例数据里的占位符**")
        print("   （示例中学、2026年09月20日高二09月考 这类），确认无误即可。")
    sys.exit(1 if must_total else 0)
