> 如果您是中文母语者，建议您阅读 [README.md](README.md)。

# 成绩分析工作台 · Grade Analysis Workbench

> A single-machine (offline) grade-analysis tool for high-school homeroom teachers: import exam score sheets exported from the Wuyue (五岳) grading system, get class- and student-level statistics and weak-spot detection automatically, then let an LLM draft a per-student remediation list and a two-week training plan.

## ⚠️ Read this first

This project is a **16-year-old high-school student's** work, built from scratch for a real teaching need of their own homeroom teacher, entirely through **vibe coding** — i.e. by giving instructions in natural language.

**Not a single line of code was typed by hand.** Everything — the low-level parser for the exam exports, the front-end UI, the automated tests and the packaging scripts — was produced by an agent (including the first draft of the README you are reading).

What I actually did: product design, requirement breakdown, architectural decisions, quality acceptance (testing), and complaining about the UX.

| | |
|---|---|
| Version | v0.1.2 (experimental — see §7 for the honest limitations) |
| Platform | Windows 10 / 11, 64-bit |
| Development tool | DeepSeek Harness |
| Model | DeepSeek V4.1 Flash |
| Token usage | ≈ **602M tokens** as of 2026-10-17 23:48 |
| Total cost | ≈ **¥19 CNY** |

**Why Apache-2.0 rather than the far more common MIT: patent risk.** MIT only grants copyright permissions and says nothing about patents. Apache-2.0 adds an explicit patent license on top of the copyright grant, plus a patent-retaliation clause — anyone who sues the project over patents automatically loses the patent license they were given. A tool like this is quite likely to be picked up, forked and even sold by other teachers, schools or companies, so Apache-2.0 is safer for everyone downstream. Full text in [`LICENSE`](LICENSE), attribution in [`NOTICE`](NOTICE), third-party components in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

> ### 🌏 Scope and applicability — please read
>
> This project was built for a **mainland-China high-school** context, and it is quite specific about that context:
>
> - it **parses the export format of the Wuyue (五岳) exam-scanning platform** — three specific spreadsheets with a specific, occasionally broken layout;
> - it assumes the **Chinese "new gaokao" (新高考) subject structure** — e.g. 语文/数学/英语 plus electives such as 物理/化学/地理, each with its own full marks;
> - its AI prompts are written with **Chinese classroom conventions** in mind (班级均分, 班名次, 讲评 suggestions), and the whole **UI is Chinese-only**.
>
> If you are outside that context — a different country, a different grading platform, a different subject system — **we make no guarantee that this project applies to the education system in your region.** The parser will not understand your export files, and the statistics and prompts will not match your school's practice. In that case please treat the code as a reference implementation of the *approach* rather than a drop-in tool.
>
> ### 🙏 Apologies: the UI is Chinese-only
>
> The interface is available in Chinese only, because the target users are **Chinese teachers** — for a first version aimed at one real classroom, that was the only reasonable choice.
>
> **Adding more languages is something we would like to do and will consider at a later date** — but at this stage the project is only a **minimum viable product (MVP)**: getting it correct and usable for its actual users comes first. Sorry if the missing translation gets in your way. If a translation matters to you, opening an issue describing your use case is the best way to push it up the list.

*If you are a teacher, I hope it saves you some work. If you are a developer, I hope it gives you a sample of what "building software in the AI era" can look like.*

---

## 1. What this is

A **single-machine** desktop tool that turns "a pile of numbers after an exam" into something you can hand out.

**The concrete problems it solves:**

- The three spreadsheets exported by Wuyue (per-question scores, question statistics, student scores) are inconsistent, use merged-cell tricks in the headers, and take half an hour of Excel wrestling before a teacher can get anything out of them. Here you drop the folder in and it comes out.
- Finding out "which questions did the whole class miss" or "who dropped 20 places" means flipping through sheet after sheet.
- Writing remediation advice for 40 students means writing it 40 times — and the last few are worthless.

**The two things it does:**

| | Analyze view (分析台) | Plan view (方案台) |
|---|---|---|
| Scope | whole class + each student | a single student |
| Contents | class overview, per-subject averages, the questions most worth teaching (sorted by score rate), per-question scores for each student, rank history as a line chart | remediation list (subject / question-type weaknesses), two-week training schedule, printable plan |
| Output | tables and charts on screen | export to Word (`.doc`) or print to PDF, handed out to students |

Roughly: for a class of 40, from importing to the first finished plan, a couple of minutes.

## 2. What it looks like

One page, two columns: student list and exam selection on the left, analysis content in the middle/right (tables, line charts, AI chat), a single input box at the bottom.

**Analyze view** — tick the exams you want considered together on the left, ask the AI in the middle, read the computed class data on the right:

<img src="docs/图片/界面-分析台.png" width="900" alt="Analyze view: exam and student list on the left, AI chat in the middle, class overview and per-subject averages on the right">

**Class trends** — scroll the same page down and the averages across previous exams become line charts (a missing exam breaks the line instead of inventing a score):

<img src="docs/图片/界面-分析台-趋势.png" width="900" alt="Class trends: overall average and per-subject averages as line charts">

**Plan view** — one remediation list plus a two-week schedule per student, editable in place in the middle, with the AI claims that need a teacher's double-check flagged on the right:

<img src="docs/图片/界面-方案台.png" width="900" alt="Plan view: remediation and training plan for 学生13, with items needing review on the right">

> The students in the screenshots are named 学生01…学生40 and the school is "示例中学" (literally "example school") — all **synthetic data**. No real class data ever appears in this repository.
>
> There is a dark theme as well: [see it](docs/图片/界面-分析台-深色.png).

You can look at the UI without installing anything:

1. download or clone this repository;
2. open [`成绩分析工作台-首页.html`](成绩分析工作台-首页.html) in a browser.

That is the **blank-data build** — the UI, charts and interactions are all there, just without students. To actually import data and ask the AI, use the launcher described in §3 (under `file://` the browser blocks cross-origin requests, so the AI step is guaranteed to fail — that is expected).

To reproduce the screenshots above yourself (all data fake):

```powershell
python data\make_demo_page.py     # generates 成绩分析工作台-演示版.html
```

It fabricates 40 students (学生01…学生40), an example school and three monthly exams; the script uses synthetic data only and, when done, checks the generated page against the real roster as a blacklist to make sure no real name leaked in.

## 3. For teachers: unzip and run (Windows)

Download **`grade-analysis-workbench-v0.1.2-windows-x64.zip`** (≈192 MB) from [Releases](../../releases/latest), unzip it, and double-click **`启动.bat`** ("start"); the browser opens the UI at `http://127.0.0.1:3080/`.

- No Node.js, Python or database is required — the runtime is bundled.
- To stop: double-click `停止.bat` ("stop"). It only kills whatever listens on port 3080, nothing else.
- Detailed instructions: `使用说明.txt` next to the executable (Chinese only, deliberately free of technical jargon).

> **Why is the download filename in ASCII?** GitHub silently strips non-ASCII characters from release
> asset names (the original would have arrived as `-v0.1.0-windows-x64.zip`), so the archive is named in
> ASCII from the start. Nothing else changes — **the folder you get after extracting is still 成绩分析工作台**.

**Two hurdles you will probably hit first:**

| Symptom | Cause and what to do |
|---|---|
| "Windows protected your PC" | The executable is not code-signed (a commercial certificate is out of reach for a personal project). Click **More info → Run anyway**. |
| Antivirus flags an unknown program | Same reason — it is an `.exe` the scanner has never seen. Whitelist the folder, or build it from source yourself. |

**Keep the extraction path short.** The deepest paths inside the archive approach 200 characters; unzipping into a deeply nested folder can fail (the classic Windows path-length problem).

**What you need to bring:** a DeepSeek API key (apply on the DeepSeek open platform; billed per token and quite cheap), plus the score files exported by Wuyue.

**Importing** is just dragging that exported folder (or the three sheets) into this dialog; if a file is not recognised, it tells you:

<img src="docs/图片/界面-导入.png" width="460" alt="Import dialog: drop a folder, optionally add a note for the AI">

## 4. For developers: build from source

```powershell
# 1) install test dependencies (only needed to run tests)
npm install

# 2) generate home_data.json from the synthetic sample data in the repo
python data\gen_home_data.py

# 3) run the tests
python data\run_tests.py

# 4) build the runnable program directory (installs DSH from npm, copies the Node runtime)
python data\bootstrap.py
python data\bootstrap.py --check     # just check the environment first
```

After that, `DSH成绩分析工作台\` is the finished program — run it with `启动.bat` (that directory is excluded by `.gitignore`).

**Building the public release package** (renamed product + third-party licenses + privacy self-check; this is what goes to Releases):

```powershell
python data\make_release_zip.py      # output lands in build\
python data\test_release_zip.py      # end-to-end check: unzip → run → verify injection → clean up
```

Directory tree, script responsibilities and the test list: [`项目结构说明.md`](项目结构说明.md) (Chinese).

> **The score data in this repository is synthetic.** The three xlsx files under `data/fixtures/wuyue-export/` are rewritten from a real export:
> names replaced with 同学01…同学40, school replaced with "示例中学", all scores randomised — but the **sheet layout, column order
> and merged-cell traps are kept exactly as they were** (those are precisely the dirty structures the parser has to survive).
> So it is good for testing the code, and represents no real class.

## 5. Data and privacy

This is the part the project cares most about, because what it processes is **minors' report cards**.

| | |
|---|---|
| Scores, names, generated plans | live only in **your own browser's local storage** and the program directory. Nothing is uploaded to any server. |
| When anything goes online | only when you click "ask the AI" — it then talks directly to `api.deepseek.com`. |
| What is sent | by default the **student names are replaced with pseudonyms** ("学生01", "学生02") first, and the names are restored in the reply; on screen and in printouts you always see the real names. |
| API key | stored in your own browser only. |
| Parsing, statistics, charts | all computed in the browser — no backend, no third-party analytics. |

There is also a "mask student names" switch: with it on, both the screen and any printout show only pseudonyms — useful when projecting the screen or showing it to students.

<img src="docs/图片/界面-隐私设置.png" width="620" alt="Settings → Privacy: three switches (mask names, replace names before sending to AI, keep conversations locally)">

**One thing to watch:** the data lives in browser local storage, so **changing computers, changing browsers or clearing browsing data loses it**. Export a backup regularly via 「设置 → 数据 → 备份与恢复 → 导出备份」. The backup can optionally include the API key — in plain text — so keep that file safe.

## 6. Feature overview

- **Import**: drop the whole folder in; the three sheets are recognised and merged. Data can be added in several passes (a single exam exported in two batches still merges into one).
- **Multiple exams**: store any number of weekly/monthly/midterm/final exams, tick the ones to compare, designate one as the "primary" exam; rank history becomes a line chart automatically (a missed exam breaks the line — no invented scores).
- **Analysis**: class overview, per-subject averages, the questions most worth teaching, per-question scores per student, rank changes.
- **AI analysis**: hand the selected content to the model and get remediation lists, shared error causes, revision suggestions; you can follow up and continue a previous conversation.
- **Export**: one student or the whole class at once to Word (`.doc`, can be re-saved as PDF), one student per page.
- **Pseudonymisation and masking**: see the previous section.
- **Backup**: full JSON export/restore, including all exams.
- **Self-update**: Settings → Update → "Check for updates"; a newer release can be downloaded
  in one click (runs in the background, you can close the dialog and keep working), then a
  restart applies it — the launcher installs the staged package at startup.

## 7. "It's all AI-written" — some honest notes

**Why it works anyway:**

- The parser has a Python reference implementation; the JS port only passes if it matches it **field by field** (`test_parse_parity.js`).
- 244 automated check points covering import, pseudonymisation, export, backup/restore, API parameters, multi-exam isolation and charts.
- The merge logic has an identity test: split real data into two halves, merge them back, and the result must be identical to the original.
- A pre-delivery health-check script (`preflight.py`): structure, encoding, a full scan for real names, consistency.
- Every trap we hit is written down in [`docs/开发记录.md`](docs/开发记录.md) (Chinese), including failures and designs that were thrown away — that record explains better than the code how "AI-written software" was forced into being acceptable.

**And its limits, right here:**

- The UI is a **single 5,500-line HTML file** (generated by `data/gen_home_html.py`); anyone trying to read the code will question their life choices. That was the price of "double-click and it runs, works offline".
- Error messages were added one by one as real problems appeared; edge cases are certainly not all covered.
- **There is no knowledge-point data**: Wuyue's export contains only item numbers and scores, so what the AI calls a "knowledge gap" is really inferred from score rates. The UI marks this boundary.
- **Chinese-only UI** — no internationalisation yet; it is an explicit MVP decision rather than an oversight (see the note at the top).
- One class at a time; 64-bit Windows only.

## 8. License

| Object | License |
|---|---|
| This project's own code (UI, parser, launcher, build scripts, tests) | **Apache-2.0** (see [`LICENSE`](LICENSE)) |
| Copyright and attribution notices | [`NOTICE`](NOTICE) |
| Third-party code shipped with the release | keeps its own license; texts in [`licenses/`](licenses/), list in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) |

In one sentence, Apache-2.0 allows: **anyone may use, modify and redistribute this, including commercially — but must keep the copyright and license notices, state what they changed, and may not use the author's name to endorse their own version.** Compared with MIT it adds that explicit patent grant, which is why it was chosen.

> **On "unofficial":** this project uses [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (MIT) as its runtime shell and is **not** an official DeepSeek product; there is no affiliation, partnership or endorsement. That is also why the released build is named 「成绩分析工作台」 without a DSH prefix.
>
> **On redistribution duties:** the release bundle contains third-party binaries (DSH, Node.js, libvips and others), so their license texts must travel with it — libvips in particular is LGPL-3.0 and requires a way to obtain the corresponding source. Everything is in `licenses/`; [`licenses/README.txt`](licenses/README.txt) (Chinese) lists each component's version, origin and source location.

## 9. Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) ([website](https://www.deepseek.com/harness/)) — the shell around the whole program, and the playground for this "writing software in natural language" experiment.
- [SheetJS](https://sheetjs.com/) — reading xlsx in the browser.
- [jsdom](https://github.com/jsdom/jsdom) — running the UI inside Node for end-to-end tests.
- And the authors of the 500-plus dependencies inside `app-0.2.1`.

## 10. Other documents

| Document | Contents |
|---|---|
| [`docs/开发记录.md`](docs/开发记录.md) | The full development record: what was built, what was thrown away, every trap, and why each choice was made (Chinese) |
| [`docs/exe化改造记录.md`](docs/exe化改造记录.md) | A dedicated record of turning DSH into "double-click an exe and a browser opens" (Chinese) |
| [`项目结构说明.md`](项目结构说明.md) | Directory tree, quick start, test list (Chinese) |
| [`docs/文档索引.md`](docs/文档索引.md) | What lives in `docs/` (Chinese) |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Which third-party code is used, under which licenses, and the extra duties when distributing builds |

---

**One last line**: this project contains not a single hand-written line of code, but it does have 244 automated check points, a development record that includes the failures, and a real requirement that came out of an actual classroom. If you use it, back up your students' data first; if you change it, you are welcome to.
