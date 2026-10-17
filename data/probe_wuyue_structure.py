# -*- coding: utf-8 -*-
"""把三个关键 xlsx 的真实结构打印出来，作为 JS 移植的依据。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wuyue_reader import read_sheet

DIR6 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "wuyue-export")


def show_cells(rows, idx, max_col=26, label=""):
    if idx >= len(rows):
        print("   [%s] 行 %d 不存在（共 %d 行）" % (label, idx, len(rows)))
        return
    r = rows[idx]
    print("   [%s] 行 %d 共 %d 列:" % (label, idx, len(r)))
    cells = []
    for j in range(min(len(r), max_col)):
        v = r[j]
        if str(v).strip() != "":
            cells.append("%d=%r" % (j, v))
    print("        " + "  ".join(cells))


# ── ① 各科小题分 ──
p = os.path.join(DIR6, "06_各科小题分.xlsx")
names, _ = read_sheet(p, max_rows=1)
print("=" * 90)
print("① 06_各科小题分.xlsx   工作表:", names)
_, rows = read_sheet(p, sheet_name=names[0])
print("   总行数:", len(rows))
for i in (0, 1, 2, 3):
    show_cells(rows, i, 30, "小题分")
print()

# ── ② 各科试题分析 ──
p = os.path.join(DIR6, "06_各科试题分析.xlsx")
names, _ = read_sheet(p, max_rows=1)
print("=" * 90)
print("② 06_各科试题分析.xlsx   工作表:", names)
_, rows = read_sheet(p, sheet_name=names[0])
print("   总行数:", len(rows))
for i in (0, 1, 2, 3, 4):
    show_cells(rows, i, 16, "试题分析")
print()

# ── ③ 学生成绩(方向名次) ──
p = os.path.join(DIR6, "06_学生成绩(方向名次).xlsx")
names, _ = read_sheet(p, max_rows=1)
print("=" * 90)
print("③ 06_学生成绩(方向名次).xlsx   工作表:", names)
_, rows = read_sheet(p, sheet_name=names[0])
print("   总行数:", len(rows))
for i in (0, 1, 2, 3, 4, 5, 6):
    show_cells(rows, i, 34, "学生成绩")
print("   最后一行:")
show_cells(rows, len(rows) - 1, 34, "学生成绩末行")
