# -*- coding: utf-8 -*-
"""
重新做一次工作台注入（把成绩工作台塞进 DSH 前端 index.html）。

为什么要单独有这个脚本：
  更新时启动器会自动做这件事（还会用时间戳刷新 ?v=），
  但"重新打一个完整交付包"的时候不会经过更新流程，
  而 index.html 里的 iframe 是 _workbench.html?v=<时间戳> ——
  如果时间戳没变，浏览器可能直接用缓存里的旧工作台页面，
  表现为"换了新包但界面还是老的"。

注入内容与 Launcher.cs 里的 IntegrateWorkbench 保持一致。
"""
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "DSH成绩分析工作台")
DIST = os.path.join(P, "app-0.2.1", "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")
INDEX = os.path.join(DIST, "index.html")
TPL = os.path.join(DIST, "index.dsh-original.html")

CSS = """
  <style>
    #workbench-layer{position:fixed;inset:0;z-index:2147483000;background:#f3f3f3;border:none;width:100%;height:100%}
    html.wb-hidden #workbench-layer{display:none}
    #wb-toggle{position:fixed;right:16px;bottom:16px;z-index:2147483001;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 15px;border-radius:17px;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.86);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 2px 8px rgba(0,0,0,.14);color:#1a1a1a;font:600 12.5px/1 'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif;cursor:pointer}
    #wb-toggle:hover{background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18)}
    #wb-toggle .dot{width:7px;height:7px;border-radius:50%;background:#0078d4}
    @media (prefers-color-scheme: dark){#wb-toggle{background:rgba(45,45,45,.86);border-color:rgba(255,255,255,.14);color:#fff}#workbench-layer{background:#202020}}
  </style>
"""

BODY = (
    '\n  <iframe id="workbench-layer" src="./_workbench.html?v=%s" title="成绩分析工作台"></iframe>\n'
    '  <button id="wb-toggle"><span class="dot"></span><span id="wb-toggle-label">切到 DSH 界面</span></button>\n'
    '  <script>(function(){var K=\'wb-show-workbench\',r=document.documentElement,l=document.getElementById(\'wb-toggle-label\');'
    'function a(s){r.classList.toggle(\'wb-hidden\',!s);if(l)l.textContent=s?\'切到 DSH 界面\':\'切回成绩工作台\';try{localStorage.setItem(K,s?\'1\':\'0\')}catch(e){}}'
    'var v=null;try{v=localStorage.getItem(K)}catch(e){}a(v===null?true:v===\'1\');'
    'document.getElementById(\'wb-toggle\').addEventListener(\'click\',function(){a(r.classList.contains(\'wb-hidden\'))});})();</script>\n'
)

if not os.path.exists(INDEX):
    raise SystemExit("找不到前端 index.html: %s" % INDEX)

# 原版模板：没有就从未被改过的 index.html 建一份
cur = open(INDEX, encoding="utf-8").read()
if not os.path.exists(TPL):
    if "workbench-layer" in cur:
        raise SystemExit("index.html 已集成，但没有原版模板 —— 没法干净地重做")
    open(TPL, "w", encoding="utf-8").write(cur)
    print("已建立原版模板 index.dsh-original.html")

tpl = open(TPL, encoding="utf-8").read()
if "workbench-layer" in tpl:
    raise SystemExit("模板本身就含集成，放弃（避免叠加）")

build = str(int(time.time()))
html = tpl.replace("</head>", CSS + "</head>")
html = html.replace("</body>", BODY % build + "</body>")
open(INDEX, "w", encoding="utf-8").write(html)

m = re.search(r"_workbench\.html\?v=(\d+)", html)
print("已重新注入 index.html")
print("  iframe 版本戳 ?v=%s" % (m.group(1) if m else "?"))
print("  index.html 大小 %d 字节" % len(html))
print("  模板 index.dsh-original.html 大小 %d 字节" % len(tpl))
