# -*- coding: utf-8 -*-
"""
打对外发布包（GitHub Releases 用的那个 zip）。

和平日里"交给老师"的打包（make_zip.py）的区别：
  1. 文件夹名与启动器改成中性名字「成绩分析工作台」，不再挂 DSH 前缀
     —— DSH 是上游项目的名字；我们的成品不顶它的名号，避免"官方/合作"的误解
  2. 附上 licenses/ 里的第三方许可证原文，以及 LICENSE / NOTICE / THIRD-PARTY-NOTICES.md
     —— 因为发布包里含有 DSH、Node.js、libvips 等第三方二进制，再分发必须带许可证
  3. 打完自检：结构、关键文件、路径长度、真名 / 本机路径 / 账号泄漏、sha256
  4. zip 的文件名用 ASCII（--slug），包内的文件夹名仍是中文（--name）
     —— GitHub Release 会悄悄去掉附件名里的非 ASCII 字符：
        `成绩分析工作台-v0.1.0-windows-x64.zip` 上传后会变成 `-v0.1.0-windows-x64.zip`。
        所以下载文件名从源头就用 ASCII，包内解压出来的文件夹名不受影响。

用法：
    python data/make_release_zip.py
    python data/make_release_zip.py --src "D:\\某处\\DSH成绩分析工作台"
    python data/make_release_zip.py --name 成绩分析工作台 --slug grade-analysis-workbench --version 0.1.0

不复制那个几百 MB 的目录：直接读源目录，按新名字写进 zip。
"""
import argparse
import hashlib
import json
import os
import sys
import time
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)                 # 仓库根（To Github/ 或 clone 出来的目录）

# 源目录：构建产物（bootstrap.py 生成）。仓库旁边一份、仓库里一份都认。
CANDIDATES = [os.path.join(REPO, os.pardir, "DSH成绩分析工作台"),
              os.path.join(REPO, "DSH成绩分析工作台")]

REWRITE_EXE = "DSH成绩分析工作台.exe"          # 源里启动器的名字
REWRITE_BAT = "启动.bat"
REWRITE_TXT = "使用说明.txt"
EXTRA = ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md"]   # 从仓库搬进发布包

BOM = b"\xef\xbb\xbf"


def longpath(p):
    ap = os.path.abspath(p)
    if os.name == "nt" and not ap.startswith("\\\\?\\"):
        return "\\\\?\\" + ap
    return ap


def read_bytes(p):
    with open(longpath(p), "rb") as f:
        return f.read()


def default_src():
    for p in CANDIDATES:
        if os.path.isdir(os.path.join(p, "app-0.2.1")):
            return os.path.abspath(p)
    return None


# ────────────────────────────── 改写 ──────────────────────────────

def fix_start_bat(raw, new_exe):
    """启动.bat 是 GBK + CRLF，里面写死了 exe 名字。"""
    s = raw.decode("gbk")
    n = s.count(REWRITE_EXE)
    if n == 0:
        raise SystemExit("启动.bat 里找不到 %s（改名逻辑失效，先别打包）" % REWRITE_EXE)
    s = s.replace(REWRITE_EXE, new_exe)
    if "DSH成绩分析工作台" in s:
        raise SystemExit("启动.bat 里还残留旧名字")
    if "\r\n" not in s:
        raise SystemExit("启动.bat 换行丢了")
    print("  启动.bat：替换 %d 处 exe 名字" % n)
    return s.encode("gbk")


def fix_manual(raw, name):
    """使用说明.txt 是 UTF-8 BOM + CRLF。"""
    if not raw.startswith(BOM):
        raise SystemExit("使用说明.txt 不是 UTF-8 BOM")
    s = raw[len(BOM):].decode("utf-8")
    n = s.count("DSH成绩分析工作台")
    if n == 0:
        raise SystemExit("使用说明.txt 里找不到旧名字")
    s = s.replace("DSH成绩分析工作台", name)
    print("  使用说明.txt：替换 %d 处软件名" % n)

    # ① 文件夹清单里补上许可证相关条目
    anchor = "  update\\                   更新包放这里（里面另有程序自带的文件，别删）"
    if anchor not in s:
        raise SystemExit("使用说明.txt 里找不到 update\\ 那一行，无法插入许可证条目")
    extra = (anchor + "\r\n"
             "  LICENSE                   本项目的开源协议（Apache-2.0 全文）\r\n"
             "  NOTICE                    版权与第三方归属声明\r\n"
             "  THIRD-PARTY-NOTICES.md    用了哪些第三方代码、各自什么协议\r\n"
             "  licenses\\                 第三方许可证原文（DSH / Node / libvips 等）")
    s = s.replace(anchor, extra, 1)

    # ② 末尾补一节"关于开源与许可证"
    if not s.rstrip().endswith("=" * 64):
        raise SystemExit("使用说明.txt 的结尾不是分隔线，无法追加章节")
    s = s.rstrip() + "\r\n\r\n" + (
        "────────────────────────────────────────────────────────\r\n"
        " 九、关于开源与许可证\r\n"
        "────────────────────────────────────────────────────────\r\n"
        "\r\n"
        "  这个软件是开源的，源码在项目的 GitHub 仓库里。\r\n"
        "  本项目自己的代码按 Apache-2.0 授权（见 LICENSE）。\r\n"
        "\r\n"
        "  它还打包了别人的东西，各自的协议仍然归各自：\r\n"
        "    · DeepSeek Harness（DSH）    MIT       本软件跑在它的外壳里\r\n"
        "    · Node.js 运行时             MIT       自带的 node.exe\r\n"
        "    · sharp / libvips            Apache-2.0 + LGPL-2.1 / LGPL-3.0\r\n"
        "    · LibreOffice Kit            MPL-2.0\r\n"
        "    · 其余 500 多个依赖           大多为 MIT / ISC / BSD\r\n"
        "\r\n"
        "  每一份协议原文都在 licenses\\ 文件夹里；\r\n"
        "  名称、版本、在哪儿取的、源码怎么获得，写在 licenses\\README.txt。\r\n"
        "\r\n"
        "  说明：本软件不是 DeepSeek 的官方产品，与 DeepSeek 没有隶属关系，\r\n"
        "        只是用了他们开源的 DSH 当运行外壳。\r\n"
        "\r\n"
        "  如果你需要本包里某个 LGPL 组件的源代码，或者对协议有疑问，\r\n"
        "  可以在项目仓库的 Issues 里说一声。\r\n"
        "\r\n"
        + "=" * 64 + "\r\n"
    )
    return BOM + s.encode("utf-8")


# ────────────────────────────── 打包 ──────────────────────────────

def collect(src, name, new_exe):
    """返回 [(源路径 或 None, zip 内路径, 内存内容 或 None)]"""
    items = []
    n_rewrite = 0
    for r, d, fs in os.walk(src):
        d.sort()
        for f in sorted(fs):
            p = os.path.join(r, f)
            rel = os.path.relpath(p, src)
            arc = name + "/" + rel.replace(os.sep, "/")
            if rel == REWRITE_EXE:
                items.append((p, name + "/" + new_exe, None))
                continue
            if rel == REWRITE_BAT:
                items.append((None, arc, fix_start_bat(read_bytes(p), new_exe)))
                n_rewrite += 1
                continue
            if rel == REWRITE_TXT:
                items.append((None, arc, fix_manual(read_bytes(p), name)))
                n_rewrite += 1
                continue
            items.append((p, arc, None))

    for fname in EXTRA:
        p = os.path.join(REPO, fname)
        if not os.path.isfile(p):
            raise SystemExit("仓库里缺少 " + fname)
        items.append((p, name + "/" + fname, None))

    lic = os.path.join(REPO, "licenses")
    if not os.path.isdir(lic):
        raise SystemExit("仓库里缺少 licenses/ 目录")
    for f in sorted(os.listdir(lic)):
        p = os.path.join(lic, f)
        if os.path.isfile(p):
            items.append((p, "%s/licenses/%s" % (name, f), None))
    return items, n_rewrite


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=None, help="构建出来的成品目录（默认自动找）")
    ap.add_argument("--name", default="成绩分析工作台",
                    help="发布用软件名：决定 zip 内文件夹名与启动器 exe 名（可以是中文）")
    ap.add_argument("--slug", default="grade-analysis-workbench",
                    help="zip 文件名前缀，只用 ASCII。GitHub Release 会把附件名里的非 ASCII 字符去掉"
                         "（中文会整个消失，只剩一个连字符），所以下载文件名必须用 ASCII；"
                         "包内文件夹名仍由 --name 决定")
    ap.add_argument("--version", default="0.1.0")
    ap.add_argument("--outdir", default=None)
    args = ap.parse_args()

    src = args.src or default_src()
    if not src or not os.path.isdir(src):
        raise SystemExit("找不到成品目录，请用 --src 指定（先跑 python data/bootstrap.py）")
    name = args.name
    new_exe = name + ".exe"
    root = os.path.dirname(os.path.abspath(src))
    outdir = args.outdir or os.path.join(root, "build")
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, "%s-v%s-windows-x64.zip" % (args.slug, args.version))

    print("源目录: %s" % src)
    print("发布名: %s  v%s" % (name, args.version))
    print("下载文件名: %s（ASCII，因为 GitHub 会去掉附件名里的中文）" % os.path.basename(out))
    print()

    items, n_rewrite = collect(src, name, new_exe)
    print("待写入条目: %d（其中改写 %d 个）" % (len(items), n_rewrite))
    print()

    if os.path.exists(out):
        os.remove(out)
    t0 = time.time()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for i, (sp, arc, data) in enumerate(items, 1):
            if data is not None:
                z.writestr(arc, data)
            else:
                z.write(longpath(sp), arc)
            if i % 5000 == 0:
                print("  已写入 %d/%d（%.0f 秒）" % (i, len(items), time.time() - t0))
    print()
    print("打包完成：%.1f MB，用时 %.0f 秒 → %s"
          % (os.path.getsize(out) / 1048576, time.time() - t0, out))
    print()

    print("===== 自检 =====")
    bad = []
    with zipfile.ZipFile(out) as z:
        entries = z.namelist()
        print("  zip 内条目数: %d" % len(entries))
        if len(entries) != len(items):
            bad.append("条目数不一致")

        need = [name + "/启动.bat", name + "/停止.bat", name + "/使用说明.txt",
                name + "/" + new_exe, name + "/runtime/node.exe",
                name + "/update/_workbench.html", name + "/update/xlsx.full.min.js",
                name + "/app-0.2.1/node_modules/@deepseek-ai/dsh/lib/bin.js",
                name + "/LICENSE", name + "/NOTICE", name + "/THIRD-PARTY-NOTICES.md",
                name + "/licenses/README.txt", name + "/licenses/Apache-2.0.txt",
                name + "/licenses/LGPL-3.0.txt", name + "/licenses/GPL-3.0.txt",
                name + "/licenses/MPL-2.0.txt", name + "/licenses/MIT-Node.js.txt"]
        for n in need:
            ok = n in entries
            print("  %s %s" % ("[OK]" if ok else "[!!]", n))
            if not ok:
                bad.append("缺少 " + n)

        # 旧名字只能出现在仓库文档里（我们在 THIRD-PARTY-NOTICES 里解释了改名原因），
        # 交付给用户的脚本与说明里必须已经改干净
        old = []
        for n in (name + "/启动.bat", name + "/停止.bat", name + "/使用说明.txt"):
            if n in entries and "DSH成绩分析工作台" in z.read(n).decode("utf-8", "replace"):
                old.append(n)
        for n in entries:
            if n.lower().endswith((".html", ".js")) and "/node_modules/" not in n:
                if z.getinfo(n).file_size < 8 * 1024 * 1024:
                    if "DSH成绩分析工作台" in z.read(n).decode("utf-8", "replace"):
                        old.append(n)
        print("  %s 交付脚本与界面里没有旧名字 DSH成绩分析工作台" % ("[OK]" if not old else "[!!]"))
        if old:
            bad.append("仍含旧名字: %s" % old[:3])

        bat = z.read(name + "/启动.bat").decode("gbk")
        ok = (new_exe in bat) and (REWRITE_EXE not in bat)
        print("  %s 启动.bat 指向 %s" % ("[OK]" if ok else "[!!]", new_exe))
        if not ok:
            bad.append("启动.bat 的 exe 名不对")

        longest = max(entries, key=len)
        print("  最长条目 %d 字符" % len(longest))
        if len(longest) > 250:
            bad.append("路径过长")

        forbidden = [n for n in entries if any(s in n for s in (
            "data-0.2.1/", "_backup", "_开发文件", "_devtools", "home_data.json"))]
        print("  %s 没有数据目录 / 备份 / 开发文件夹" % ("[OK]" if not forbidden else "[!!]"))
        if forbidden:
            bad.append("混入不该有的目录")
        if any(n.endswith(".zip") for n in entries):
            bad.append("包里还套着 zip")

        # 隐私扫描：只扫人写的部分（node_modules 是上游代码，不会有学生数据）
        names = []
        hp = os.path.join(REPO, "data", "home_data.json")
        if os.path.isfile(hp):
            with open(hp, encoding="utf-8") as f:
                names = [s["姓名"] for s in json.load(f)["学生"]]
        hits = []
        scanned = 0
        for n in entries:
            if "/app-0.2.1/node_modules/" in n or "/runtime/" in n:
                continue
            if not n.lower().endswith((".bat", ".txt", ".md", ".html", ".json", ".js", ".css")):
                continue
            if z.getinfo(n).file_size > 4 * 1024 * 1024:
                continue
            t = z.read(n).decode("utf-8", "replace")
            scanned += 1
            for nm in names:
                if nm and nm in t:
                    hits.append((n, nm))
            for mark in ("wxid", "D:\\01_Projects", "C:\\Users\\HW"):
                if mark in t:
                    hits.append((n, mark))
        print("  %s 扫了 %d 个文本文件，真名 / wxid / 本机路径命中：%d"
              % ("[OK]" if not hits else "[!!]", scanned, len(hits)))
        if hits:
            for h in hits[:10]:
                print("      ", h)
            bad.append("隐私扫描命中 %d 处" % len(hits))

    h = hashlib.sha256()
    with open(out, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    print()
    print("  SHA-256: %s" % h.hexdigest())
    print("  文件大小: %d 字节" % os.path.getsize(out))

    if bad:
        print()
        print("!! 自检不通过：")
        for b in bad:
            print("   -", b)
        sys.exit(1)
    print()
    print("===== 发布包通过自检 =====")


if __name__ == "__main__":
    main()
