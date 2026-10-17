# -*- coding: utf-8 -*-
"""
一键构建：把本仓库组装成"双击就能跑"的程序目录 `DSH成绩分析工作台/`。

仓库里**不带** DSH、Node 运行时和任何第三方二进制（体积大、也没必要跟着版本库走），
这个脚本负责把它们补回来，然后生成工作台页面、注入前端、生成启动脚本和启动器。

用法：
    python data\\bootstrap.py              # 完整构建
    python data\\bootstrap.py --check      # 只检查环境，不动文件
    python data\\bootstrap.py --skip-exe   # 不编译 exe（没有 csc.exe 的机器用）

依赖：Python 3.8+、node/npm（构建机上有即可，成品里会自带 node.exe）。
      编译启动器需要 Windows 自带的 .NET Framework csc.exe。
"""
import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DELIVERY = os.path.join(ROOT, "DSH成绩分析工作台")
APP = os.path.join(DELIVERY, "app-0.2.1")
DSH_VER = "0.2.1-alpha.1"

CSC = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"


def run(cmd, cwd=None, allow_fail=False):
    print("   $", " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True, errors="replace")
    if r.stdout.strip():
        print("     " + r.stdout.strip().replace("\n", "\n     ")[:1500])
    if r.returncode != 0:
        msg = (r.stderr or "").strip()[:800]
        if allow_fail:
            print("     [忽略失败]", msg)
            return False
        raise SystemExit("命令失败（退出码 %d）：%s" % (r.returncode, msg))
    return True


def which(exe):
    return shutil.which(exe)


def check_env():
    print("环境检查：")
    ok = True
    print("   python  :", sys.version.split()[0])
    node = which("node")
    npm = which("npm") or which("npm.cmd")
    print("   node    :", node or "（没找到）")
    print("   npm     :", npm or "（没找到）")
    print("   csc.exe :", CSC if os.path.exists(CSC) else "（没找到 —— 将跳过 exe 编译）")
    if not node:
        print("   !! 没有 node，无法用 npm 安装 DSH")
        ok = False
    if not npm:
        print("   !! 没有 npm，无法用 npm 安装 DSH")
        ok = False
    print("   目标目录:", DELIVERY)
    print("   结论:", "可以构建" if ok else "缺少依赖")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查环境")
    ap.add_argument("--skip-exe", action="store_true", help="不编译启动器 exe")
    args = ap.parse_args()

    if args.check:
        sys.exit(0 if check_env() else 1)

    if not check_env():
        sys.exit(1)

    print()
    print("=" * 68)
    print("① 建立程序目录")
    for d in (APP, os.path.join(DELIVERY, "runtime"), os.path.join(DELIVERY, "update")):
        os.makedirs(d, exist_ok=True)
    print("   ", DELIVERY)

    print()
    print("=" * 68)
    print("② 从 npm 安装 DSH（%s）—— 这一步最慢，要下几百 MB" % DSH_VER)
    npm = which("npm") or which("npm.cmd")
    if not os.path.isdir(os.path.join(APP, "node_modules", "@deepseek-ai", "dsh")):
        run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund",
             "--prefix", APP, "@deepseek-ai/dsh@" + DSH_VER])
    else:
        print("   已经装过，跳过")

    print()
    print("=" * 68)
    print("③ 复制 node 运行时")
    node_exe = which("node")
    dst_node = os.path.join(DELIVERY, "runtime", "node.exe")
    if node_exe:
        shutil.copy2(node_exe, dst_node)
        print("   已复制:", dst_node)
    else:
        print("   !! 没找到 node.exe，成品里将缺少运行时")

    print()
    print("=" * 68)
    print("④ 生成工作台页面（空白数据版）")
    run([sys.executable, os.path.join(DATA, "gen_home_html.py")])

    print()
    print("=" * 68)
    print("⑤ 同步页面与 SheetJS 到前端目录")
    run([sys.executable, os.path.join(DATA, "sync_workbench.py")])

    print()
    print("=" * 68)
    print("⑥ 注入工作台到 DSH 前端 index.html")
    run([sys.executable, os.path.join(DATA, "reintegrate.py")])

    print()
    print("=" * 68)
    print("⑦ 生成 启动.bat / 停止.bat")
    run([sys.executable, os.path.join(DATA, "make_start_bat.py")])
    run([sys.executable, os.path.join(DATA, "make_stop_bats.py")])

    print()
    print("=" * 68)
    print("⑧ 编译启动器")
    if args.skip_exe or not os.path.exists(CSC):
        print("   跳过（--skip-exe 或没有 csc.exe）。程序仍可用 启动.bat 启动。")
    else:
        run([sys.executable, os.path.join(DATA, "build_launcher.py")])

    print()
    print("=" * 68)
    print("⑨ 完成")
    print("   程序目录:", DELIVERY)
    print("   双击「启动.bat」即可使用；第一次启动后会生成 data-0.2.1\\ 与 _开发文件\\。")
    print()
    print("   想验证构建是否完好，可以跑：")
    print("     python data\\preflight.py            # 结构/编码/一致性体检")
    print("     python data\\test_delivery_final.py  # 整体跑一遍")


if __name__ == "__main__":
    main()
