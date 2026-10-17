# -*- coding: utf-8 -*-
"""
五岳成绩分析（已通过 240/240 全量校验）

重要：五岳的"小题分"表里存在【合并列】与【细分列】并存的重复计分现象，
直接全列相加会算重复。实测证据（语文样例学生）：
    45 = 5.0  而  第4题(3.0) + 第5题(2.0) = 5.0   ← "45"是合并列
    89 = 4.0  而  第8题(2.0) + 第9题(2.0) = 4.0
    1314 = 8.0 而 13-1(4)+13-2(2)+14(2) = 8.0
只取细分列后，6 科 40 名学生 = 240 人次全部与总分吻合。

本脚本的输出：
  1. 合并列识别 + 总分校验（地基自检，每次换数据都要先跑这个）
  2. 全班丢分地图（哪道题全班丢得多）
  3. 个人丢分清单
"""
import sys
import io
import os

# 让脚本在当前目录下也能 import 同目录的读取器
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from wuyue_reader import read_sheet

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DIR6 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "wuyue-export")

SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "地理"]
BASE_COLS = ["学校", "班级", "考号", "姓名", "选科"]
META_COLS = ["总分", "班名次", "校名次", "客观题", "主观题"]


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def find_parent_cols(score_cols):
    """
    找出"合并列"。

    判定规则：列名是纯数字串，且它左边的列里存在能拼出它的题号成员。
    例：'45'   -> 成员 '4','5'        （语文第4、5题）
        '89'   -> 成员 '8','9'
        '1314' -> 成员 '13-1','13-2','14'（取主号 13,13,14）
        '17'   -> 成员 '17-1','17-2','17-3'（地理）
    反例：数学的 '15' 不会被误判，因为 '1' 和 '5' 不是独立的题号列。
    """
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
    """读取小题分，返回 {科目: {'items':[...], 'parents':[...], 'students':[...]}}"""
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
            rec = {
                "考号": str(r[2]).strip(),
                "姓名": str(r[3]).strip(),
                "选科": str(r[4]).strip() if len(r) > 4 else "",
            }
            scores = {}
            for j, nm in enumerate(item_names):
                idx = 5 + j
                if idx < len(r):
                    scores[nm] = num(r[idx])
            rec["scores"] = scores
            students.append(rec)
        data[subj] = {"items": item_names, "parents": parents, "students": students}
    return data


def verify(detail):
    """
    地基自检：只用细分列求和，看是否等于总分。
    每次换新数据都必须先跑这个，否则后面的分析可能建立在错误之上。
    """
    print("=" * 100)
    print("【零】地基自检：细分列之和 vs 总分（必须先通过）")
    print("=" * 100)
    all_pass = True
    for subj, d in detail.items():
        parents = d["parents"]
        if parents:
            print(f"  [{subj}] 检测到合并列（已排除，避免重复计分）: {parents}")
        ok = checked = 0
        bad = []
        for s in d["students"]:
            total = s["scores"].get("总分")
            if total is None:
                continue
            checked += 1
            acc = sum(
                v for nm, v in s["scores"].items()
                if nm not in META_COLS and nm not in parents and v
            )
            if abs(total - acc) < 0.01:
                ok += 1
            else:
                bad.append((s["姓名"], total, round(acc, 2)))
        flag = "✔" if ok == checked else "✘"
        if ok != checked:
            all_pass = False
        print(f"  {flag} [{subj}] {ok}/{checked} 名学生吻合")
        if bad:
            print(f"      不符: {bad[:4]}")
    print()
    if all_pass:
        print("  ➜ 自检通过，可以放心分析。\n")
    else:
        print("  ➜ ⚠ 自检未通过！数据解析规则可能不适用于这批数据，后面的结论不可信。\n")
    return all_pass



def load_exam_analysis():
    """读取试题分析：每题满分 / 难度 / 区分度 / 干扰项"""
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
                "答案": str(r[1]).strip() if len(r) > 1 else "",
                "满分": num(r[3]) if len(r) > 3 else None,
                "平均分": num(r[5]) if len(r) > 5 else None,
                "得分率": num(r[7]) if len(r) > 7 else None,
                "零分率": num(r[9]) if len(r) > 9 else None,
                "难度": num(r[10]) if len(r) > 10 else None,
                "区分度": num(r[11]) if len(r) > 11 else None,
                "其他作答": str(r[13]).strip() if len(r) > 13 else "",
            }
        out[subj] = items
    return out


def main():
    detail = load_detail()
    analysis = load_exam_analysis()

    verify(detail)

    print("=" * 100)
    print("【一】全班名单（来自小题分·数学表）")
    print("=" * 100)
    math = detail["数学"]
    roster = math["students"]
    print(f"数学参考人数: {len(roster)}")
    print("前 5 名:", [s["姓名"] for s in roster[:5]])
    print("选科分布:", sorted({s["选科"] for s in roster}))

    # 各科人数是否一致
    print("\n各科人数:", {k: len(v["students"]) for k, v in detail.items()})

    print("\n" + "=" * 100)
    print("【二】丢分地图：全班最该讲的题（按得分率从低到高）")
    print("=" * 100)
    for subj in SUBJECTS:
        if subj not in analysis:
            continue
        items = analysis[subj]
        parents = set(detail.get(subj, {}).get("parents", []))
        # 只看真实细分题目：有满分、且不是合并列（合并列会重复计分）
        qs = {
            k: v for k, v in items.items()
            if v["满分"] and v["满分"] > 0 and k not in parents
        }
        hard = sorted(qs.items(), key=lambda kv: (kv[1]["得分率"] if kv[1]["得分率"] is not None else 999))
        print(f"\n--- {subj}（共 {len(qs)} 个计分单元）---")
        for name, v in hard[:5]:
            warn = " ★全班性失分" if (v["得分率"] or 100) < 50 else ""
            print(
                f"  {name:<8} 满分{v['满分']:>5.1f}  平均{v['平均分']:>5.2f}  "
                f"得分率{v['得分率']:>5.1f}%  难度{v['难度']:>4.2f}  区分度{v['区分度']:>5.2f}{warn}"
            )
            if v["其他作答"]:
                print(f"           典型错选: {v['其他作答'][:70]}")

    print("\n" + "=" * 100)
    target_name = sys.argv[1] if len(sys.argv) > 1 else (detail["数学"]["students"][0]["姓名"])
    print(f"【三】个人丢分清单（抽样：{target_name}）")
    print("=" * 100)
    for subj in SUBJECTS:
        d = detail.get(subj)
        if not d:
            continue
        stu = next((s for s in d["students"] if s["姓名"] == target_name), None)
        if not stu:
            continue
        qa = analysis.get(subj, {})
        parents = set(d.get("parents", []))
        lost = []
        for nm, sc in stu["scores"].items():
            if nm in META_COLS or nm in parents:
                continue
            full = (qa.get(nm) or {}).get("满分")
            if full and sc is not None and sc < full:
                lost.append((nm, sc, full, full - sc))
        if not lost:
            continue
        lost.sort(key=lambda x: -x[3])
        total_lost = sum(x[3] for x in lost)
        print(f"\n--- {subj}  个人总分 {stu['scores'].get('总分')}  共丢 {total_lost:.1f} 分 ---")
        for nm, sc, full, gap in lost[:6]:
            print(f"  {nm:<8} 得 {sc:>5.1f} / {full:>5.1f}   丢 {gap:>5.1f} 分")

    print("\n" + "=" * 100)
    print("【四】结论")
    print("=" * 100)
    print("如果上面三块都正常输出了，说明：题号级丢分地图 + 个人丢分清单 = 数据层可行。")


if __name__ == "__main__":
    main()
