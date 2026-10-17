# -*- coding: utf-8 -*-
"""
做一份"带数据的演示页面"，专门用来截图：假学生名（学生01…学生40）+ 全假数据 + 三场假考试。

为什么要单独生成：
  · 正式的 `成绩分析工作台-首页.html` 必须是**空白版**（交付物、仓库里都靠它）；
  · 截图需要能看到表格、学生名单和名次趋势折线图，空页面截出来没内容；
  · 所以这里产出**另一个文件名**的页面，不碰正式产物，也不碰真实数据。

数据来源只认 `To Github\\data\\home_data.json`（仓库里那份合成数据，同学01…）：
把姓名换成"学生NN"，学校/班级换成示例值，再由 `make_demo_exams.js` 造出三场考试
（8 月 / 9 月 / 10 月月考，分数略有波动），最后把这三场考试"预置"进页面的
localStorage —— 这样打开就能看到多次考试切换和折线图。

真实名册只被当**黑名单**读一次，用来确认假页面里没漏出真名。

用法：
    python data\\make_demo_page.py
    python data\\make_demo_page.py --out 我的截图页.html
"""
import argparse
import json
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)

# 合成数据：工作区布局在 "To Github\\data\\"，仓库布局就是 "data\\" 自己
SYNTH_CANDIDATES = [
    os.path.join(ROOT, "To Github", "data", "home_data.json"),
    os.path.join(BASE, "home_data.json"),
]
SYNTH = next((p for p in SYNTH_CANDIDATES if os.path.exists(p)), SYNTH_CANDIDATES[0])
REAL = os.path.join(BASE, "home_data.json")                        # 真实数据（只读，当黑名单）
DEMO_JSON = os.path.join(BASE, "demo_home_data.json")              # 演示数据（合成 + 改名）
SEED_JSON = os.path.join(BASE, "demo_exams_seed.json")             # 三场考试（localStorage 预置）
EXAMS_JS = os.path.join(BASE, "make_demo_exams.js")

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(ROOT, "成绩分析工作台-演示版.html"))
args = ap.parse_args()
OUT = os.path.abspath(args.out)


def run(cmd, what):
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr.strip()[:2000])
        raise SystemExit("%s 失败" % what)


# ── 1) 取合成数据 ──
if not os.path.exists(SYNTH):
    raise SystemExit("找不到合成数据：%s" % SYNTH)
with open(SYNTH, encoding="utf-8") as f:
    data = json.load(f)
if not data.get("学生"):
    raise SystemExit("合成数据里没有学生")

# ── 2) 姓名统一换成"学生NN"，学校/班级换成示例值 ──
renamed = 0
for s in data["学生"]:
    old = s.get("姓名", "")
    m = re.match(r"^(?:同学|学生)(\d+)$", old)
    if not m:
        raise SystemExit("合成数据里出现了意料之外的姓名 %r，先确认它不是真实姓名" % old)
    s["姓名"] = "学生%02d" % int(m.group(1))
    if s["姓名"] != old:
        renamed += 1

data["考试"]["学校"] = "示例中学"
data["班级"]["名称"] = "高二 01 班"

with open(DEMO_JSON, "w", encoding="utf-8", newline="\n") as f:
    json.dump(data, f, ensure_ascii=False)
print("演示数据：%s（%d 名学生，改名 %d 个）"
      % (os.path.basename(DEMO_JSON), len(data["学生"]), renamed))

# ── 3) 造三场考试（8/9/10 月月考）──
print()
run([os.path.join(ROOT, "DSH成绩分析工作台", "runtime", "node.exe"), EXAMS_JS]
    if os.path.exists(os.path.join(ROOT, "DSH成绩分析工作台", "runtime", "node.exe"))
    else ["node", EXAMS_JS], "生成三场考试")

# ── 4) 生成页面（不碰正式产物）──
print()
cmd = [sys.executable, os.path.join(BASE, "gen_home_html.py"),
       "--with-data", "--data", DEMO_JSON, "--out", OUT]
print("生成页面 → %s" % OUT)
run(cmd, "生成页面")

# ── 4b) 截图用的"假 AI 内容"：一段问答 + 一份方案 ──
#      不是让页面去调 API（file:// 下必然失败），而是把"已经生成好"的内容塞进去，
#      这样截图里能看到像样的分析结论和方案草稿。数字全部来自上面造的假数据。
def stats(data, subj):
    vals = [s["各科"][subj] for s in data["学生"] if subj in s["各科"]]
    return min(vals), max(vals)


with open(SEED_JSON, encoding="utf-8") as f:
    seed_obj = json.load(f)
LAST = seed_obj["exams"][-1]["data"]
PHY_LO, PHY_HI = stats(LAST, "物理")
GEO_LO, GEO_HI = stats(LAST, "地理")
AVG = {s["科目"]: s["均分"] for s in LAST["科目统计"]}
PLAN_STU = "学生13"
PLAN = next(s for s in LAST["学生"] if s["姓名"] == PLAN_STU)

AI_HTML = (
    '<div class="think">已按 40 人 × 6 科的逐题得分排序，取得分率最低的几道题</div>'
    "<p><b>地理这次是全班性的失分点</b>：得分率最低的两道题都在地理，"
    "而且错误选项高度集中在同一个字母上——这说明是某个知识点没讲透，不是个别学生粗心。</p>"
    "<h3>一、最该讲的题</h3>"
    "<table><tr><th>题目</th><th>得分率</th><th>典型错选</th></tr>"
    "<tr><td>地理 单选5</td><td>1.5%</td><td>C（33 人 / 82.5%）</td></tr>"
    "<tr><td>地理 单选1</td><td>10.4%</td><td>B（28 人 / 70.0%）</td></tr>"
    "<tr><td>化学 单选7</td><td>10.9%</td><td>C（20 人 / 50.0%）</td></tr>"
    "<tr><td>物理 13</td><td>11.0%</td><td>—</td></tr>"
    "<tr><td>语文 21</td><td>11.2%</td><td>—</td></tr>"
    "</table>"
    "<p>地理单选 5 全班只拿到 1.5%，82.5% 的同学选了 C。建议课上直接把 C 当反例讲，"
    "讲清“为什么不是 C”，比只对答案有效得多。</p>"
    "<h3>二、分数结构</h3><ul>"
    "<li>物理均分 <b>{}</b>，是六科里最低的；班内从 {} 到 {}，分层明显，"
    "不适合全班同一套讲法。</li>"
    "<li>地理班内差距最大（{} → {}），适合课后个别辅导，不必占全班时间。</li>"
    "</ul>"
    "<h3>三、下周建议</h3><ol>"
    "<li>用 10 分钟集中讲地理单选 5、单选 1（同一个知识点）。</li>"
    "<li>化学单选 7 配一道同类变式当作业，第二天收上来再讲。</li>"
    "<li>物理按分数分层：{} 分以下先补受力分析基础，{} 分以上做综合题。</li>"
    "</ol>"
    '<p><span class="pill warn">需要您复核</span>'
    "按得分率排序只反映本次的失分情况；如果这几道题本身就偏难，请以讲评价值为准。</p>"
).format(AVG["物理"], PHY_LO, PHY_HI, GEO_LO, GEO_HI,
         round((PHY_LO + PHY_HI) / 2, 1), round((PHY_LO + PHY_HI) / 2, 1))

PLAN_PARSED = {
    "title": "%s 的补弱与训练方案" % PLAN_STU,
    "subtitle": "%s · 班名次 %d / %d · 总分 %s"
                % (LAST["考试"]["名称"], PLAN["班名次"], LAST["班级"]["人数"], PLAN["总分"]),
    "intro": "这次总分排班里第 %d，化学和英语明显高于班均；真正拖后腿的是物理——"
             "%s 分，比班均低 %s，也是六科里唯一低于班均的科目。"
             % (PLAN["班名次"], PLAN["各科"]["物理"],
                round(AVG["物理"] - PLAN["各科"]["物理"], 1)),
    "subjects": [
        {"subject": k, "score": PLAN["各科"][k], "avg": AVG[k],
         "diff": round(PLAN["各科"][k] - AVG[k], 1)}
        for k in ("语文", "数学", "英语", "物理", "化学", "地理")
    ],
    "weakList": [
        "物理：%s 分（班均 %s），是本次唯一的短板，优先补" % (PLAN["各科"]["物理"], AVG["物理"]),
        "语文：%s 分，比班均低 %s，主要在选择题与文言翻译上失分"
        % (PLAN["各科"]["语文"], round(AVG["语文"] - PLAN["各科"]["语文"], 1)),
    ],
    "hardQuestions": ["地理 单选5（得分率 1.5%）", "地理 单选1（10.4%）", "化学 单选7（10.9%）"],
    "trainingPlan": [
        {"when": "第 1 周", "focus": "物理", "what": "每天 20 分钟：受力分析 3 题 + 前一天的错题重做 1 题"},
        {"when": "第 1 周", "focus": "语文", "what": "隔天 15 分钟：文言实词 10 个 + 翻译 1 句"},
        {"when": "第 2 周", "focus": "物理", "what": "每天 20 分钟：单选限时 5 题，改错写清错因"},
        {"when": "第 2 周", "focus": "化学", "what": "只做本次错的那一类题，巩固优势"},
    ],
    "checkPoint": "两周后看下一次月考：物理单选的正确率能否到 60%，语文选择题少错 2 道。",
    "notes": [
        "物理不是靠题量，先把每道题画出示意图再动笔。",
        "化学和英语保持现在的节奏，不要额外加负担。",
    ],
    "closing": "先补物理，其余科目稳住就行。",
}

DEMO_CONTENT = {
    "keys": [{"id": "demo-key", "name": "DeepSeek Key（演示）",
              "key": "sk-demo-0000000000000000"}],
    "analyze": {
        "id": "demo-conv", "title": "本次考试分析", "keyId": "demo-key",
        "messages": [
            {"role": "user", "html": "这次考试全班最需要讲哪几道题？哪些同学要重点关注？"},
            {"role": "ai", "html": AI_HTML},
        ],
    },
    # 两个台面的对话用同一个 id：state.activeId 是全局唯一的，
    # 这样切到方案台时 activeConv() 也能找到它。
    "planConv": {
        "id": "demo-conv", "title": "%s 的方案讨论" % PLAN_STU, "keyId": "demo-key",
        "messages": [
            {"role": "user", "html": "帮我给 %s 出一份补弱清单，物理太差了。" % PLAN_STU},
            {"role": "ai", "html": "<p>已经生成好了，左侧「方案草稿」里可以直接改。</p>"
                                   "<p>核心判断：<b>物理是唯一短板</b>（%s 分，班均 %s），"
                                   "化学、英语是优势科目，不要在这两科上再加量。</p>"
                                   % (PLAN["各科"]["物理"], AVG["物理"])},
        ],
    },
    "plan": {"student": PLAN_STU, "typeLabel": "补弱+训练", "parsed": PLAN_PARSED},
}
print("截图内容：分析台 1 问 1 答、方案 1 份（%s），密钥 1 个（假）" % PLAN_STU)

# ── 5) 把三场考试预置进 localStorage（放在 </head> 之前，页面脚本之前执行）──
with open(OUT, encoding="utf-8") as f:
    page = f.read()
if "</head>" not in page:
    raise SystemExit("页面里找不到 </head>，注入失败")
with open(SEED_JSON, encoding="utf-8") as f:
    seed_raw = f.read()
seed_js = json.dumps(seed_raw, ensure_ascii=False).replace("<", "\\u003c")  # 防止 </script> 截断
inject = (
    "<!-- 截图用：预置三场演示考试（全部合成数据）。若浏览器禁止 file:// 使用 "
    "localStorage，这段会静默失败，页面退回只显示嵌入的那一场。 -->\n"
    "<script>try{localStorage.setItem('dsh-grade-workbench-v6-exams', %s);}catch(e){}</script>\n"
    % seed_js
)
def insert_before(html, tag, payload, which="last"):
    """把 payload 插到 tag 之前。

    这个页面里 `</head>` 和 `</body>` 各出现两次：一次是真的文档结构，
    另一次在页面脚本的字符串里（导出 Word/PDF 时要拼完整的 HTML）。
    所以：
      · </head> 取**第一个**（真文档的 head 结束）
      · </body> 取**最后一个**（真文档的 body 结束）
    插错位置会把代码塞进 JS 字符串里，直接语法错误 —— 这条踩过。
    """
    i = html.find(tag) if which == "first" else html.rfind(tag)
    if i < 0:
        raise SystemExit("页面里找不到 %s，注入失败" % tag)
    return html[:i] + payload + html[i:]


page = insert_before(page, "</head>", inject, which="first")

# ── 5b) 兜底 + 截图内容：页面脚本跑完后再补一刀。
#   ① 有些浏览器/设置禁止 file:// 使用 localStorage —— 那种情况下上面的预置静默失败，
#      页面只会剩嵌入的那一场考试（没折线图）。这里发现只有一场就直接灌进页面状态。
#   ② 把"假 AI 内容"塞进去：假密钥（让界面显示「AI 已就绪」而不是黄色警告）、
#      一段分析问答、一份方案草稿。
content_js = json.dumps(DEMO_CONTENT, ensure_ascii=False).replace("<", "\\u003c")
fallback = (
    "<!-- 截图用：兜底三场考试 + 假密钥 / 假对话 / 假方案（全部合成数据）。 -->\n"
    "<script>(function(){try{\n"
    "  if (typeof state === 'undefined' || !state.exams) return;\n"
    "  var o = JSON.parse(%s);\n"
    "  var c = %s;\n"          # DEMO_CONTENT 直接当对象字面量，不用 JSON.parse
    "  if (state.exams.length < 2) {\n"
    "    state.exams = o.exams;\n"
    "    state.selectedExamIds = o.selectedExamIds;\n"
    "    state.primaryExamId = o.primaryExamId;\n"
    "    DATA = o.exams[o.exams.length - 1].data;\n"
    "  }\n"
    "  if (!state.keys.length) state.keys = c.keys;\n"
    "  state.conversations = { analyze: [c.analyze], plan: [c.planConv] };\n"
    "  state.activeId = c.analyze.id;\n"
    "  if (!state.plans.length) {\n"
    "    var ph = '';\n"
    "    try { ph = renderEditedPlan(c.plan.parsed); } catch (e) { ph = ''; }\n"
    "    if (ph) state.plans = [{ id: 'demo-p1', student: c.plan.student, type: 'both',\n"
    "      typeLabel: c.plan.typeLabel, html: ph, createdAt: Date.now() }];\n"
    "  }\n"
    "  if (typeof saveExams === 'function') saveExams();\n"
    "  if (typeof save === 'function') save();\n"
    "  if (typeof renderAll === 'function') renderAll();\n"
    "}catch(e){}})();</script>\n" % (seed_js, content_js)
)
page = insert_before(page, "</body>", fallback, which="last")
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(page)

# ── 6) 自检：假名都在、真名一个都不在、三场考试都在 ──
problems = []
if "学生01" not in page or "学生40" not in page:
    problems.append("页面里找不到 学生01 / 学生40")
leftover = sorted(set(re.findall(r"(?:同学|学生)\d+", page)))
if any(x.startswith("同学") for x in leftover):
    problems.append("页面里还有合成数据的旧名：%s" % [x for x in leftover if x.startswith("同学")][:5])
for name in ("高二08月考", "高二09月考", "高二10月考"):
    if name not in page:
        problems.append("页面里没有 %s（三场考试没注入成功）" % name)

real_names = []
if os.path.exists(REAL):
    try:
        with open(REAL, encoding="utf-8") as f:
            real_json = json.load(f)
        real_names = [s.get("姓名", "") for s in real_json.get("学生", []) if s.get("姓名")]
    except Exception as e:
        print("（真实名册读不到，跳过黑名单比对：%s）" % e)
leak = [n for n in real_names if n and n in page]
if leak:
    problems.append("页面里出现了真实姓名：%s" % leak[:5])

print()
print("产物：%s" % OUT)
print("大小：%.1f KB" % (os.path.getsize(OUT) / 1024))
print("黑名单比对：真实名册 %d 个姓名，命中 %d 个" % (len(real_names), len(leak)))
print()
if problems:
    print("!! 自检不通过：")
    for p in problems:
        print("   -", p)
    sys.exit(1)
print("===== 演示页面自检通过（假名 + 假数据 + 三场假考试，无真实姓名）=====")
print("用浏览器打开这个文件就能截图；『问 AI』会失败（file:// 下跨域被拦），属正常。")
print("想换回一场考试的数据：删掉这个文件重新生成，或告诉我改成单场版。")
