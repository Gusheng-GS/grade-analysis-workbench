# -*- coding: utf-8 -*-
"""
M1 第 1 步：把一份 .docx 试卷切成逐题结构化数据。

为什么不能用"直接抽纯文本"：化学卷的公式和图大多是嵌入对象，
抽纯文本会丢内容（"通入___，___为___"）。所以按 document.xml 的**原始顺序**
遍历：文字取文字，图片/嵌入对象取 [图n] 占位，同时把图片按顺序导出。

用法：
    python data\\parse_paper_docx.py "简易题库\\高二上学期第一次月考化学试卷.docx" --out "简易题库\\化学09月考" --answers "简易题库\\高二上学期第一次月考化学解析.docx"
"""
import argparse
import io
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
V = "{urn:schemas-microsoft-com:vml}"
O = "{urn:schemas-microsoft-com:office:office}"

ROOT = r"D:\01_Projects\Python_Projects\Student_Performance_Tracking_Dashboard"


def find_rels(z):
    """rId → media 路径。"""
    rels = {}
    try:
        xml = z.read("word/_rels/document.xml.rels")
    except KeyError:
        return rels
    for rel in ET.fromstring(xml):
        rid = rel.get("Id")
        target = rel.get("Target", "")
        if rid and target:
            rels[rid] = target
    return rels


def para_items(p, rels):
    """返回这个段落里的有序片段：('t', 文字) / ('img', rId)。嵌套顺序按文档顺序。"""
    out = []

    def walk(el):
        tag = el.tag
        # 跳过 Word 的"修订痕迹"：w:del / w:moveFrom 里是被删掉的旧文字。
        # 不跳过的话，卷面上会多出一层红色乱码（"pun def 1x2.." 那种），
        # 因为解析时把删除线里的副本也当成正文读了。
        if tag in (W + "del", W + "moveFrom", W + "delText"):
            return
        if tag == W + "t":
            out.append(("t", el.text or ""))
            return
        if tag == W + "tab":
            out.append(("t", " "))
            return
        if tag == W + "br":
            out.append(("t", "\n"))
            return
        if tag == A + "blip":
            rid = el.get(R + "embed")
            if rid:
                out.append(("img", rid))
            return
        if tag == V + "imagedata":
            rid = el.get(R + "id")
            if rid:
                out.append(("img", rid))
            return
        for ch in list(el):
            walk(ch)

    walk(p)
    return out


def table_rows(tbl, to_text):
    """把 w:tbl 读成 [[{t, cs, v}, ...], ...]。

    cs = 横向合并的格数（w:gridSpan）；v = 这一格是纵向合并的"续格"（w:vMerge continue）。
    化学卷里的实验数据表全靠这两个，不读的话表格会被压成一串单格。
    """
    rows = []
    for tr in tbl.findall(W + "tr"):
        cells = []
        for tc in tr.findall(W + "tc"):
            span, cont = 1, False
            tcPr = tc.find(W + "tcPr")
            if tcPr is not None:
                gs = tcPr.find(W + "gridSpan")
                if gs is not None:
                    try:
                        span = max(1, int(gs.get(W + "val", "1")))
                    except (TypeError, ValueError):
                        span = 1
                vm = tcPr.find(W + "vMerge")
                if vm is not None:
                    cont = (vm.get(W + "val") or "continue") == "continue"
            parts = []
            for p in tc.iter(W + "p"):
                t = to_text(para_items(p, [])).strip()
                if t:
                    parts.append(t)
            cells.append({"t": " ".join(parts), "cs": span, "v": cont})
        rows.append(cells)
    return rows


def build_size_map(doc):
    """rId → 这张图在 Word 里的显示尺寸（px，96dpi）。

    docx 里图片只存了原始位图，"排多大"记在 w:drawing 的 wp:extent（EMU）
    或 w:pict 里 v:shape 的 style（pt）。公式是又窄又高的一张图，光看位图尺寸
    会把它当成"独立的一张大图"，导出后就是卷面上一块巨大的公式。

    注意：**必须按 rId 配对**，不能按出现顺序排队 —— 同一张图在
    mc:AlternateContent 里往往既有 DrawingML 又有 VML 副本，
    排队会让后面的图整体错位（踩过：文字旁边的小公式被排成横条）。
    """
    out = {}
    for el in doc.iter():
        if el.tag != W + "drawing" and el.tag != W + "pict":
            continue
        rid, size = None, None
        for sub in el.iter():
            if sub.tag == A + "blip" and rid is None:
                rid = sub.get(R + "embed")
            elif sub.tag == V + "imagedata" and rid is None:
                rid = sub.get(R + "id")
            elif sub.tag == WP + "extent" and size is None:
                try:
                    cx, cy = int(sub.get("cx", 0)), int(sub.get("cy", 0))
                except (TypeError, ValueError):
                    cx = cy = 0
                if cx and cy:
                    size = (cx / 9525.0, cy / 9525.0)
            elif sub.tag == V + "shape" and size is None:
                style = sub.get("style") or ""
                mw = re.search(r"width:([\d.]+)pt", style)
                mh = re.search(r"height:([\d.]+)pt", style)
                if mw and mh:
                    size = (float(mw.group(1)) * 96 / 72, float(mh.group(1)) * 96 / 72)
        if rid and size and rid not in out:
            out[rid] = size
    return out


def parse_docx(path, media_dir=None, prefix="img"):
    z = zipfile.ZipFile(path)
    rels = find_rels(z)
    doc = ET.fromstring(z.read("word/document.xml"))
    body = doc.find(W + "body")
    img_seq = 0
    img_map = {}          # rId → 序号
    saved = []
    sizes = {}            # media 文件名 → (显示宽, 显示高)
    size_map = build_size_map(doc)

    def to_text(items):
        """片段流 → 文字（图片换成 [图n] 并按顺序存到 media）。"""
        nonlocal img_seq
        text = ""
        for kind, val in items:
            if kind == "t":
                text += val
                continue
            if val not in img_map:
                img_seq += 1
                img_map[val] = img_seq
                size = size_map.get(val)
                if media_dir:
                    src = rels.get(val, "")
                    name = os.path.basename(src)
                    base = "%s-%03d-%s" % (prefix, img_seq, name)
                    dst = os.path.join(media_dir, base)
                    try:
                        with z.open("word/" + src.replace("../", "")) as s, open(dst, "wb") as o:
                            o.write(s.read())
                        saved.append(base)
                        if size:
                            sizes[base] = [round(size[0], 1), round(size[1], 1)]
                    except KeyError:
                        pass
            text += "[图%d]" % img_map[val]
        return text

    # 按 body 的**直接子节点**顺序走：段落是段落，表格是表格。
    # 早先直接 iterate 所有 w:p，把表格里的格子当成了普通段落，
    # 于是五列数据表被压成"一行一个数字"——用户看到的就是"乱码"。
    paras, tables = [], []
    for child in body:
        if child.tag == W + "tbl":
            tables.append(table_rows(child, to_text))
            paras.append("[表%d]" % len(tables))
        elif child.tag == W + "p":
            t = to_text(para_items(child, rels)).strip()
            if t:
                paras.append(t)

    return paras, saved, tables, sizes


# 卷面上的题号：行首 1-30 的数字 + 全角/半角点号
# 题号：全角"．"或"、"打头，或半角"."且**后面不是数字**（否则 0.6 这种会被误判）
Q_RE = re.compile(r"^\s*(\d{1,2})\s*(?:[．、]|\.(?!\d))\s*")
# 大题/分区标题
SEC_RE = re.compile(r"^(第\s*[ⅠⅡⅢIVX]+\s*卷|[一二三四]\s*[、．.]\s*(选择|非选择|填空|实验|计算))")


def split_questions(paras):
    """把段落流切成 [{'no': 1, 'section': '选择题', 'text': '...'}]。

    规则：题号必须**从 1 开始连续**（1,2,3...）。
    这样 0.6 / 2.6 这类小数、以及正文里的"3.5 mol"都不会被误当成新题。
    """
    out = []
    section = ""
    expected = 1
    cur = None

    def flush():
        nonlocal cur
        if cur:
            cur["text"] = "\n".join(cur.pop("paras"))
            out.append(cur)
            cur = None

    for t in paras:
        if SEC_RE.match(t) and len(t) < 60:
            m = re.search(r"选择|非选择|填空|实验|计算", t)
            if m:
                section = m.group(0)
            continue
        lead = re.sub(r"^(?:\[图\d+\]\s*)+", "", t)   # 剥掉"图"占位再看题号
        m = Q_RE.match(lead)
        if m and int(m.group(1)) == expected:
            flush()
            cur = {"no": expected, "section": section, "paras": [t]}
            expected += 1
        elif cur:
            cur["paras"].append(t)
    flush()
    return out


ap = argparse.ArgumentParser()
ap.add_argument("paper")
ap.add_argument("--answers", default=None)
ap.add_argument("--out", default=None, help="输出目录（默认与试卷同级同名）")
args = ap.parse_args()

paper = args.paper if os.path.isabs(args.paper) else os.path.join(ROOT, args.paper)
outdir = args.out or os.path.splitext(paper)[0]
outdir = outdir if os.path.isabs(outdir) else os.path.join(ROOT, outdir)
os.makedirs(outdir, exist_ok=True)
media_dir = os.path.join(outdir, "media")
os.makedirs(media_dir, exist_ok=True)

print("① 解析试卷：%s" % os.path.basename(paper))
paras, imgs, tables, sizes = parse_docx(paper, media_dir, "paper")
qs = split_questions(paras)
print("   段落 %d 个，题 %d 道，表格 %d 张，导出图 %d 张" % (len(paras), len(qs), len(tables), len(imgs)))

ans_qs = []
a_tables = []
a_sizes = {}
if args.answers:
    ap2 = args.answers if os.path.isabs(args.answers) else os.path.join(ROOT, args.answers)
    print("② 解析解析件：%s" % os.path.basename(ap2))
    a_paras, a_imgs, a_tables, a_sizes = parse_docx(ap2, media_dir, "ans")
    ans_qs = split_questions(a_paras)
    print("   段落 %d 个，题 %d 道，表格 %d 张，导出图 %d 张" % (len(a_paras), len(ans_qs), len(a_tables), len(a_imgs)))


def attach_tables(q, tabs):
    """把题面里出现的 [表n] 对应的表格数据挂到这道题上（键就是 n）。"""
    used = {}
    for n in re.findall(r"\[表(\d+)\]", q.get("text", "")):
        i = int(n)
        if 1 <= i <= len(tabs):
            used[n] = tabs[i - 1]
    q["tables"] = used


by_no = {q["no"]: q for q in ans_qs}
for q in qs:
    a = by_no.get(q["no"])
    q["答案与解析"] = a["text"] if a else ""
    attach_tables(q, tables)
    if a:
        # 解析件里的表另编一套号，标记改成 [表aN]，免得和卷面表格号撞车
        a["text"] = a.get("text", "")
        attach_tables(a, a_tables)
        a["text"] = re.sub(r"\[表(\d+)\]", r"[表a\1]", a["text"])
        atabs = {}
        for k, v in a.get("tables", {}).items():
            atabs["a" + k] = v
        q["答案表格"] = atabs

qs.sort(key=lambda x: x["no"])
data = {
    "来源": os.path.basename(paper),
    "解析来源": os.path.basename(args.answers) if args.answers else "",
    "题数": len(qs),
    "题目": qs,
}
out_json = os.path.join(outdir, "questions.json")
io.open(out_json, "w", encoding="utf-8", newline="\n").write(
    json.dumps(data, ensure_ascii=False, indent=1) + "\n")

# 图片在 Word 里的显示尺寸单独存一份：build_bank.py 用它决定"公式跟着文字走"还是"独立成行"
all_sizes = dict(sizes)
all_sizes.update(a_sizes)
size_json = os.path.join(outdir, "media_sizes.json")
io.open(size_json, "w", encoding="utf-8", newline="\n").write(
    json.dumps(all_sizes, ensure_ascii=False, indent=1) + "\n")
print("   显示尺寸: %d 张（%s）" % (len(all_sizes), os.path.basename(size_json)))

print()
print("③ 结果")
print("   写出: %s" % out_json)
for q in qs:
    print("   %2d. [%s] %3d 字  %d 图  解析:%s  %s"
          % (q["no"], (q["section"] or "?")[:3], len(q["text"]),
             q["text"].count("[图"), "有" if q["答案与解析"] else "无",
             q["text"][:34].replace("\n", " ")))
