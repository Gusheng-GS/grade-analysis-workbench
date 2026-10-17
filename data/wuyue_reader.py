# -*- coding: utf-8 -*-
"""
零依赖 .xlsx 读取器（只用 Python 标准库）
用途：在不安装任何第三方库的前提下，先看清五岳导出文件的真实结构。
xlsx 本质是一个 zip 包，里面是若干 XML。
"""
import zipfile
import re
import sys
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_to_index(ref):
    """把 A1 这种坐标里的列名 A 转成 0 开始的列号"""
    letters = re.match(r"([A-Z]+)", ref)
    if not letters:
        return 0
    n = 0
    for ch in letters.group(1):
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def _shared_strings(z):
    """读取共享字符串表"""
    out = []
    if "xl/sharedStrings.xml" not in z.namelist():
        return out
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall(f"{NS}si"):
        # 富文本会拆成多个 <t>，全部拼起来
        parts = [t.text or "" for t in si.iter(f"{NS}t")]
        out.append("".join(parts))
    return out


def _sheet_names(z):
    """读取工作表名 -> 内部路径 的映射"""
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {}
    for rel in rels:
        rid_to_target[rel.get("Id")] = rel.get("Target")
    sheets = []
    for sh in wb.iter(f"{NS}sheet"):
        name = sh.get("name")
        rid = sh.get(f"{NS_R}id")
        target = rid_to_target.get(rid, "")
        if target and not target.startswith("/"):
            target = "xl/" + target.lstrip("/")
        sheets.append((name, target))
    return sheets


def read_sheet(path, sheet_name=None, max_rows=None):
    """读一个工作表，返回二维列表（字符串）"""
    with zipfile.ZipFile(path) as z:
        shared = _shared_strings(z)
        sheets = _sheet_names(z)
        if not sheets:
            return [], []
        target = None
        if sheet_name:
            for nm, tgt in sheets:
                if nm == sheet_name:
                    target = tgt
                    break
        if target is None:
            sheet_name, target = sheets[0]
        names = [nm for nm, _ in sheets]

        root = ET.fromstring(z.read(target))
        rows = []
        for r in root.iter(f"{NS}row"):
            cells = {}
            for c in r.findall(f"{NS}c"):
                ref = c.get("r") or ""
                ci = _col_to_index(ref)
                ctype = c.get("t")
                v = c.find(f"{NS}v")
                is_node = c.find(f"{NS}is")
                if ctype == "s" and v is not None:
                    try:
                        val = shared[int(v.text)]
                    except (ValueError, IndexError):
                        val = ""
                elif ctype == "inlineStr" and is_node is not None:
                    val = "".join(t.text or "" for t in is_node.iter(f"{NS}t"))
                elif v is not None:
                    val = v.text or ""
                else:
                    val = ""
                cells[ci] = val
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(i, "") for i in range(width)])
            else:
                rows.append([])
            if max_rows and len(rows) >= max_rows:
                break
        return names, rows


def preview(path, max_rows=8, max_cols=25, label=""):
    print("=" * 100)
    print(f"文件: {label or path.split(chr(92))[-1]}")
    try:
        names, _ = read_sheet(path, max_rows=1)
        print(f"工作表({len(names)}): {names}")
        for nm in names:
            _, rows = read_sheet(path, sheet_name=nm, max_rows=max_rows)
            print(f"\n  --- 工作表 [{nm}] 前 {len(rows)} 行 ---")
            for i, row in enumerate(rows):
                show = row[:max_cols]
                tail = " …" if len(row) > max_cols else ""
                print(f"  {i:>2}| " + " | ".join(str(x)[:18] for x in show) + tail)
    except Exception as e:
        print(f"  [读取失败] {type(e).__name__}: {e}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        preview(p)
