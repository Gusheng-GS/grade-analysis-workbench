# -*- coding: utf-8 -*-
"""
把题库正文（题干 / 选项 / 图 / 答案与解析）压成一份 JS，嵌进页面里。

为什么要这一步：
    组卷台原来只有 8 道"题干首句"，导出的小卷只有题干、没有选项和图，
    老师拿到手里没法用。这个脚本把 09 月考化学那几道题的完整正文取出来，
    图按 640px 宽压成 64 色 PNG（再大就只是占地方），base64 内联，
    这样页面和导出的 .doc 都是自包含的，不用带一个图片文件夹。

用法：
    python data\\build_bank.py                     # 默认读 简易题库\\化学09月考
    python data\\build_bank.py --nos 7,11,13,14,15,16,17,18 --out data\\asm_bank.js
    python data\\build_bank.py --no-images         # 只取文字（不想装 Pillow 时）

生成的文件（data\\asm_bank.js）**不进 git**：里面是老师试卷的真实内容，
课程材料的版权不属于本仓库。仓库里没有这个文件时，页面自动退回"只有题干"。
"""

import argparse
import base64
import io
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)

DEFAULT_BANK = os.path.join(ROOT, "简易题库", "化学09月考")
DEFAULT_OUT = os.path.join(BASE, "asm_bank.js")

# 页面里题目编号的写法：1–14 是单选，15–18 是非选择
def asm_no(n):
    return ("单选%d" % n) if n <= 14 else str(n)


def strip_number(text):
    """去掉开头的题号：'7．下列事实…' -> '下列事实…'"""
    return re.sub(r"^\s*\d{1,2}\s*(?:[．、]|\.(?!\d))\s*", "", text or "")


def split_options(text):
    """
    把题干和选项拆开。

    题库里选项有时一行一个，有时几个挤在一行（"A．…   B．…   C．…"），
    所以按"A．/B．/C．/D．"这些标记切，而不是按行切。
    """
    m = re.search(r"A\s*[．.、]", text)
    if not m or m.start() == 0:
        return text.strip(), []
    head, rest = text[:m.start()], text[m.start():]
    parts = re.split(r"(?=[A-D]\s*[．.、])", rest)
    opts = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if not re.match(r"^[A-D]\s*[．.、]", p):
            # 上一段的尾巴（选项写一半换行之类），并回上一条
            if opts:
                opts[-1] += p
            continue
        opts.append(re.sub(r"^([A-D])\s*[．.、]\s*", r"\1．", p))
    return head.strip(), opts


def split_answer(raw):
    """'7．…【答案】B【详解】A．…' -> ('B', 'A．…')"""
    txt = raw or ""
    i = txt.find("【答案】")
    if i < 0:
        return "", re.sub(r"\[图\d+\]", "〔图〕", txt)
    ans_part = txt[i + len("【答案】"):]
    j = ans_part.find("【详解】")
    if j >= 0:
        ans = ans_part[:j].strip()
        detail = ans_part[j + len("【详解】"):].strip()
    else:
        ans, detail = ans_part.strip(), ""
    ans = re.sub(r"\s+", " ", ans)
    # 答案行里的图也是"解析件"的图号，同样加 a 前缀，页面会把它们排成行内小图
    ans = re.sub(r"\[图(\d+)\]", r"[图a\1]", ans)
    if len(ans) > 40:                       # 非选择题的答案是长句，截一段够用了
        ans = ans[:40]
        ans = re.sub(r"\[图[0-9a-z]*$", "", ans)   # 别把标记截成半截 [图a1
        ans = ans.rstrip("，,、；; ") + "…"
    # 解析里的图来自"解析件"那份 docx，两边的图号是各自编的，会撞车，
    # 所以加 a 前缀（页面里认 [图aN]），免得卷面图 21 和解析图 21 串成一张。
    detail = re.sub(r"\[图(\d+)\]", r"[图a\1]", detail)
    return ans, detail


def encode_image(path, width=640, colors=64):
    """压成一张小 PNG：宽度上限 640，调色板 64 色。

    返回 (data URI, 宽, 高) —— 带宽高是为了排版时判断"这张图是句中的公式还是
    独立的一张图"：窄而矮的公式要跟着文字走（inline），宽的要单独占一行。
    """
    try:
        from PIL import Image
    except ImportError:
        # 没装 Pillow 时这里返回 None，图就全丢了 —— 一定要吼一声，别悄悄生成一个没有图的题库。
        if not globals().get("_warned_pil"):
            print("!! 没有 Pillow，图片会被全部跳过（小卷上只剩〔图N〕占位）。")
            print("   用带 Pillow 的 Python 跑，或者 pip install pillow")
            globals()["_warned_pil"] = True
        return None
    im = Image.open(path)
    if im.width > width:
        h = max(1, round(im.height * width / im.width))
        im = im.resize((width, h), Image.LANCZOS)
    out = io.BytesIO()
    im.convert("RGBA").convert("P", palette=Image.ADAPTIVE, colors=colors).save(out, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii"), im.width, im.height


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", default=DEFAULT_BANK, help="题库目录（含 questions.json 和 media\\）")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--nos", default="7,11,13,14,15,16,17,18", help="要取哪些题（数字，逗号分隔）")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--colors", type=int, default=64)
    ap.add_argument("--no-images", action="store_true", help="只取文字，不内联图片")
    a = ap.parse_args()

    qfile = os.path.join(a.bank, "questions.json")
    if not os.path.exists(qfile):
        sys.exit("找不到题库：" + qfile)
    data = json.load(open(qfile, encoding="utf-8"))
    items = data["题目"] if isinstance(data, dict) else data
    want = set(int(x) for x in a.nos.split(",") if x.strip())

    media = os.path.join(a.bank, "media")
    out, n_img, img_kb = [], 0, 0
    for it in items:
        no = it.get("no")
        if no not in want:
            continue
        text = strip_number(it.get("text", ""))
        # 选择题才有选项；非选择题里出现的 "A．" 多是小题标号，别当选项
        if no <= 14:
            stem, opts = split_options(text)
        else:
            stem, opts = text.strip(), []
        ans, detail = split_answer(it.get("答案与解析", ""))

        imgs = {}
        if not a.no_images:
            # 题干/选项里的图：来自试卷那份 docx（paper-…）
            for n in sorted(set(int(x) for x in re.findall(r"\[图(\d+)\]", text))):
                p = os.path.join(media, "paper-%03d-image%d.png" % (n, n))
                if not os.path.exists(p):
                    continue
                enc = encode_image(p, a.width, a.colors)
                if enc:
                    uri, iw, ih = enc
                    # w/h 让页面决定这张图排成"句中的公式"还是"独立的一张图"
                    imgs[str(n)] = {"u": uri, "w": iw, "h": ih}
                    n_img += 1
                    img_kb += len(uri) / 1024
            # 答案与解析里的图：来自解析件那份 docx（ans-…），键名加 a 前缀
            for n in sorted(set(int(x) for x in re.findall(r"\[图a(\d+)\]", detail))):
                p = os.path.join(media, "ans-%03d-image%d.png" % (n, n))
                if not os.path.exists(p):
                    continue
                enc = encode_image(p, a.width, a.colors)
                if enc:
                    uri, iw, ih = enc
                    imgs["a%d" % n] = {"u": uri, "w": iw, "h": ih}
                    n_img += 1
                    img_kb += len(uri) / 1024
        out.append({
            "no": asm_no(no),
            "section": it.get("section", ""),
            "text": stem,
            "opts": opts,
            "imgs": imgs,
            "ans": ans,
            "detail": detail,
        })

    js = "window.__ASM_BANK__ = " + json.dumps(out, ensure_ascii=False) + ";\n"
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* 题库正文（由 data/build_bank.py 生成，内容来自老师试卷，不进 git） */\n")
        f.write(js)

    print("题数 %d，内联图 %d 张（%.0f KB），文件 %.1f KB" % (
        len(out), n_img, img_kb, os.path.getsize(a.out) / 1024))
    for q in out:
        print("  %-6s 题干 %d 字 · 选项 %d 条 · 图 %d 张 · 答案 %s" % (
            q["no"], len(q["text"]), len(q["opts"]), len(q["imgs"]), q["ans"][:12] or "—"))


if __name__ == "__main__":
    main()
