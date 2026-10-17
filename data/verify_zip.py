# -*- coding: utf-8 -*-
"""校验交付 zip：完整性（CRC 全比对）+ 解压路径深度风险。"""
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Z = os.path.join(ROOT, "DSH成绩分析工作台-%s.zip" % time.strftime("%Y%m%d"))

print("=== ① 完整性（逐条 CRC 比对，相当于把整包解一遍）===")
t0 = time.time()
with zipfile.ZipFile(Z) as z:
    bad = z.testzip()
    n = len(z.namelist())
    total = sum(i.file_size for i in z.infolist())
    comp = sum(i.compress_size for i in z.infolist())
print("  条目 %d 个，解压后 %.1f MB，压缩后 %.1f MB，用时 %.0f 秒"
      % (n, total / 1048576, comp / 1048576, time.time() - t0))
print("  损坏条目:", bad if bad else "无")
if bad:
    sys.exit("!! zip 有损坏")

print()
print("=== ② 解压路径深度风险 ===")
with zipfile.ZipFile(Z) as z:
    rel = sorted((len(i.filename), i.filename) for i in z.infolist())
longest = rel[-1]
print("  最长条目: %d 字符" % longest[0])
print("     %s" % longest[1][:140])
LIMIT = 259   # Windows 资源管理器/传统 API 的路径上限
for base, label in ((r"C:\Users\sample\Downloads", "下载文件夹（约 20 字符）"),
                    (r"C:\Users\sample\Desktop", "桌面（约 20 字符）"),
                    (r"D:\成绩分析", "D 盘短目录（约 10 字符）"),
                    (ROOT, "本项目根目录（约 63 字符）")):
    over = [f for L, f in rel if len(base) + 1 + L > LIMIT]
    flag = "OK" if not over else "有 %d 个文件会解压失败" % len(over)
    print("  %-30s 最长全路径 %3d 字符 → %s" % (label, len(base) + 1 + longest[0], flag))
    if over:
        print("     例如:", over[0][:130])
