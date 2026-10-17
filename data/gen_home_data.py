# -*- coding: utf-8 -*-
"""
从五岳导出数据提取"首页所需的数据包"。

首页（三栏）需要的东西：
  左栏  班级 + 学生名单（含总分、班级排名）
  中栏  对话区（后续接 AI，先放占位）
  右栏  成绩分析：全班概况、科目均分、最该讲的题、待复核清单

输出：home_data.json —— 前端直接嵌入，不需要任何后端。

注意：默认输出真名（本地使用）；如需脱敏，把 MASK_NAMES 改成 True，
姓名会变成"学生01"这种代号。
"""
import sys
import io
import os
import re
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wuyue_reader import read_sheet

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

MASK_NAMES = False   # True = 姓名替换为代号（对外分享时用）

DIR6 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "wuyue-export")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "home_data.json")

SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "地理"]
META_COLS = {"总分", "班名次", "校名次", "客观题", "主观题"}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def find_parent_cols(score_cols):
    """识别"合并列"（与细分列重复计分），规则见数据摸底报告。"""
    def is_parent(name):
        if not name.isdigit():
            return False
        nums = []
        for s in score_cols:
            if s == name or s in META_COLS:
                continue
            head = s.split("-")[0]
            if head.isdigit():
                nums.append(head)

        def dfs(rem, used):
            if not rem:
                return True
            for i, x in enumerate(nums):
                if i in used:
                    continue
                if rem.startswith(x) and dfs(rem[len(x):], used | {i}):
                    return True
            return False

        return dfs(name, set())

    return [c for c in score_cols if is_parent(c)]


def load_detail():
    """每个学生每道题的得分。"""
    path = os.path.join(DIR6, "06_各科小题分.xlsx")
    names, _ = read_sheet(path, max_rows=1)
    data = {}
    for subj in names:
        _, rows = read_sheet(path, sheet_name=subj)
        if len(rows) < 3:
            continue
        item_names = [str(x).strip() for x in rows[1][5:]]
        score_cols = [n for n in item_names if n not in META_COLS]
        parents = find_parent_cols(score_cols)
        students = []
        for r in rows[2:]:
            if not r or not str(r[3] if len(r) > 3 else "").strip():
                continue
            scores = {}
            for j, nm in enumerate(item_names):
                idx = 5 + j
                if idx < len(r):
                    scores[nm] = num(r[idx])
            students.append({
                "考号": str(r[2]).strip() if len(r) > 2 else "",
                "姓名": str(r[3]).strip(),
                "选科": str(r[4]).strip() if len(r) > 4 else "",
                "scores": scores,
            })
        data[subj] = {"items": item_names, "parents": parents, "students": students}
    return data


def load_analysis():
    """每道题的分析：满分、得分率、难度、典型错选。"""
    path = os.path.join(DIR6, "06_各科试题分析.xlsx")
    names, _ = read_sheet(path, max_rows=1)
    out = {}
    for subj in names:
        _, rows = read_sheet(path, sheet_name=subj)
        items = {}
        for r in rows[3:]:
            if not r or not str(r[0]).strip():
                continue
            items[str(r[0]).strip()] = {
                "满分": num(r[3]) if len(r) > 3 else None,
                "平均分": num(r[5]) if len(r) > 5 else None,
                "得分率": num(r[7]) if len(r) > 7 else None,
                "难度": num(r[10]) if len(r) > 10 else None,
                "典型错选": (str(r[13]).strip() if len(r) > 13 else ""),
            }
        out[subj] = items
    return out


def load_official_scores():
    """
    从官方"学生成绩(方向名次)"表读取各科分数与总分。

    为什么不用各科明细自己求和：物理/化学/地理是选考科目，
    卷面分与计入总分的分数不是一回事（赋分制），自己求和会算错总分。
    表结构：5 列基础信息 + 每科 3 列（分数 / 方向校名次 / 方向班名次）。
    """
    path = os.path.join(DIR6, "06_学生成绩(方向名次).xlsx")
    names, _ = read_sheet(path, max_rows=1)
    _, rows = read_sheet(path, sheet_name=names[0])

    header = rows[2]           # 科目名所在行
    subheader = rows[3]        # "分数 / 方向校名次 / 方向班名次"

    # 找出每个科目的"分数"列
    score_cols = {}
    for j, v in enumerate(header):
        label = str(v).strip()
        if not label:
            continue
        if j < len(subheader) and str(subheader[j]).strip() == "分数":
            score_cols[label] = j

    students = {}
    for r in rows[5:]:
        if len(r) < 6 or not str(r[3]).strip():
            continue
        name = str(r[3]).strip()
        rec = {"考号": str(r[2]).strip(), "选科": str(r[4]).strip() if len(r) > 4 else ""}
        for label, j in score_cols.items():
            rec[label] = num(r[j]) if j < len(r) else None
        students[name] = rec
    return score_cols, students


def read_metadata(src_dir):
    """
    从五岳导出里读考试/班级元信息（与网页里 WuyueParse.build 的做法一致）。

    - 学校、班级编号：来自「学生成绩」表的学生行
    - 考试名称、日期：来自表标题，例如「总分(物理)_学生成绩(方向名次)_2026年09月20日高二09月考」
    - 选科：取学生里最常见的那个
    """
    path = os.path.join(src_dir, "06_学生成绩(方向名次).xlsx")
    names, _ = read_sheet(path, max_rows=1)
    _, rows = read_sheet(path, sheet_name=names[0])

    school = ""
    cls_no = ""
    for r in rows[5:]:
        if len(r) > 3 and str(r[3]).strip():
            school = str(r[0]).strip() if len(r) > 0 else ""
            cls_no = str(r[1]).strip() if len(r) > 1 else ""
            break

    title = str(rows[0][0]).strip() if rows and rows[0] else ""
    exam_name, exam_date = "", ""
    m = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日(.*)$", title)
    if m:
        exam_date = "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
        exam_name = m.group(4).strip()
    elif title:
        exam_name = title

    track = ""
    try:
        _, off = load_official_scores()
        cnt = {}
        for rec in off.values():
            t = rec.get("选科") or ""
            if t:
                cnt[t] = cnt.get(t, 0) + 1
        if cnt:
            track = max(cnt.items(), key=lambda kv: kv[1])[0]
    except Exception:
        track = ""

    return {
        "名称": exam_name,
        "日期": exam_date,
        "学校": school,
        "班级": (cls_no + " 班") if cls_no else "",
        "选科": track,
    }


def build():
    meta = read_metadata(DIR6)
    detail = load_detail()
    analysis = load_analysis()
    score_cols, official = load_official_scores()

    # ── 学生名单：分数取官方成绩表（含赋分后的总分）─────────────────
    # 明细表只用于题目级分析，不用于求和（选考科目赋分制会算错）
    roster = []
    base = detail["数学"]["students"]
    for stu in base:
        name = stu["姓名"]
        off = official.get(name)
        if not off:
            continue
        per_subject = {}
        for subj in SUBJECTS:
            v = off.get(subj)
            if v is not None:
                per_subject[subj] = round(v, 1)
        total = off.get("总分(物理)")
        if total is None:
            total = sum(per_subject.values())
        roster.append({
            "考号": off.get("考号", stu.get("考号", "")),
            "姓名": name,
            "选科": off.get("选科", stu.get("选科", "")),
            "总分": round(total, 1),
            "各科": per_subject,
        })

    roster.sort(key=lambda x: -x["总分"])
    for i, s in enumerate(roster, 1):
        s["班名次"] = i

    # ── 全班概况 ────────────────────────────────────────────────
    totals = [s["总分"] for s in roster]
    avg_total = sum(totals) / len(totals) if totals else 0

    subject_stats = []
    for subj in SUBJECTS:
        vals = [s["各科"].get(subj) for s in roster if s["各科"].get(subj) is not None]
        if not vals:
            continue
        subject_stats.append({
            "科目": subj,
            "均分": round(sum(vals) / len(vals), 1),
            "最高": round(max(vals), 1),
            "最低": round(min(vals), 1),
        })

    # ── 最该讲的题：得分率低的全班性失分 ──────────────────────────
    hard_items = []
    for subj in SUBJECTS:
        items = analysis.get(subj, {})
        parents = set(detail.get(subj, {}).get("parents", []))
        for qname, v in items.items():
            if qname in parents or not v["满分"] or v["满分"] <= 0:
                continue
            rate = v["得分率"]
            if rate is None:
                continue
            hard_items.append({
                "科目": subj,
                "题号": qname,
                "满分": v["满分"],
                "平均分": v["平均分"],
                "得分率": round(rate, 1),
                "典型错选": v["典型错选"][:60],
            })
    hard_items.sort(key=lambda x: x["得分率"])

    # ── 待复核清单（按"需要人看一眼"的程度排序）───────────────────
    review = []
    for it in hard_items[:5]:
        review.append({
            "对象": f"{it['科目']} 第{it['题号']}题",
            "原因": f"全班得分率仅 {it['得分率']}%，平均只拿到 {it['平均分']}/{it['满分']} 分",
            "优先级": "高" if it["得分率"] < 20 else "中",
        })

    # ── 脱敏 ────────────────────────────────────────────────────
    if MASK_NAMES:
        for i, s in enumerate(roster, 1):
            s["姓名"] = f"学生{i:02d}"

    data = {
        "考试": {
            "名称": meta["名称"],
            "日期": meta["日期"],
            "学校": meta["学校"],
        },
        "班级": {
            "名称": meta["班级"],
            "选科": meta["选科"],
            "人数": len(roster),
            "科目": SUBJECTS,
        },
        "概况": {
            "总分均分": round(avg_total, 1),
            "总分最高": round(max(totals), 1) if totals else 0,
            "总分最低": round(min(totals), 1) if totals else 0,
        },
        "科目统计": subject_stats,
        "学生": roster,
        "最该讲的题": hard_items[:12],
        "待复核": review,
    }
    return data


if __name__ == "__main__":
    data = build()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("已生成:", OUT)
    print("文件大小: %.1f KB" % (os.path.getsize(OUT) / 1024))
    print()
    print("=== 数据摘要 ===")
    print(f"  班级: {data['班级']['名称']}  人数: {data['班级']['人数']}")
    print(f"  总分均分: {data['概况']['总分均分']}  最高: {data['概况']['总分最高']}")
    print(f"  科目均分:")
    for s in data["科目统计"]:
        print(f"    {s['科目']}  {s['均分']}")
    print(f"  最该讲的题（前5）:")
    for it in data["最该讲的题"][:5]:
        print(f"    {it['科目']} 第{it['题号']}题  得分率 {it['得分率']}%  平均 {it['平均分']}/{it['满分']}")
    print(f"  待复核: {len(data['待复核'])} 条")
