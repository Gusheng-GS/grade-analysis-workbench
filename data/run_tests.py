# -*- coding: utf-8 -*-
"""
统一测试入口：一次跑完所有测试。

    python data\\run_tests.py

分两类：
  · 不需要构建产物的（解析一致性、导入、隐私/导出/备份、API 设置、多考试、图表、合并）
    —— 直接跑，用的是仓库里的样例数据
  · 需要构建产物的（交付体检、启动器、更新流程、启动/停止脚本）
    —— 只有先跑过 `python data\\bootstrap.py` 生成了程序目录才会跑，否则跳过并说明
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DELIVERY = os.path.join(ROOT, "DSH成绩分析工作台")

NODE_TESTS = [
    ("test_parse_parity.js", "解析一致性（JS 与 Python 参考实现逐字段比对）"),
    ("test_merge_exam.js", "合并/补充数据逻辑"),
    ("test_import_e2e.js", "导入端到端"),
    ("test_features_e2e.js", "隐私脱敏 / 导出 / 备份恢复"),
    ("test_api_settings_e2e.js", "设置页：验钥 / 模型 / 思考参数"),
    ("test_multi_exam_e2e.js", "多考试：隔离/勾选/对比/补充"),
    ("test_charts_e2e.js", "右栏分析与折线图"),
]

BUILD_TESTS = [
    ("preflight.py", "交付前体检"),
    ("check_no_names.py", "交付物不含学生真名"),
    ("test_delivery_final.py", "交付目录整体跑一遍"),
    ("test_delivery_final.py", "交付目录整体跑一遍"),
    ("test_startup_path.py", "启动器启动路径"),
    ("test_update_sandbox.py", "更新流程（完整包）"),
    ("test_update_pageonly.py", "更新流程（只换页面）"),
    ("test_start_bat.py", "启动.bat 三条分支"),
    ("test_stop_script.py", "停止脚本兜底"),
    ("test_kill_scope.py", "测试进程清理范围"),
]


def run(exe, script):
    p = subprocess.run([exe, os.path.join(DATA, script)], cwd=ROOT,
                       capture_output=True, text=True, errors="replace")
    tail = [l for l in (p.stdout or "").splitlines() if l.strip()][-1:] or ["(无输出)"]
    return p.returncode, tail[0].strip()


def main():
    node = "node"
    where = os.path.dirname(sys.executable)
    py = sys.executable
    fails = 0

    print("=" * 74)
    print("一、不需要构建产物的测试（用仓库里的样例数据）")
    print("=" * 74)
    for script, desc in NODE_TESTS:
        code, tail = run(node, script)
        mark = "OK  " if code == 0 else "FAIL"
        print("  [%s] %-26s %s" % (mark, script, tail[:60]))
        if code != 0:
            fails += 1

    print()
    print("=" * 74)
    print("二、需要构建产物的测试")
    print("=" * 74)
    if not os.path.isdir(DELIVERY):
        print("  跳过：还没有程序目录（%s）" % os.path.relpath(DELIVERY, ROOT))
        print("        先运行:  python data\\bootstrap.py")
    else:
        seen = set()
        for script, desc in BUILD_TESTS:
            if script in seen:
                continue
            seen.add(script)
            code, tail = run(py, script)
            mark = "OK  " if code == 0 else "FAIL"
            print("  [%s] %-26s %s" % (mark, script, tail[:60]))
            if code != 0:
                fails += 1

    print()
    print("=" * 74)
    if fails:
        print("有 %d 项失败" % fails)
        sys.exit(1)
    print("全部通过" + ("（构建相关的测试已跳过）" if not os.path.isdir(DELIVERY) else ""))


if __name__ == "__main__":
    main()
