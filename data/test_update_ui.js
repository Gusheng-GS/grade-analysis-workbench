// 更新界面（设置 → 更新）的 jsdom 测试：四种状态都要对
//   ① 没有启动器（file:// 或自己构建）→ 检查按钮禁用 + 提示
//   ② 已是最新版 → 提示"已是最新版"，不显示下载按钮
//   ③ 有新版本 → 显示版本/大小/说明，点「下载并更新」会 POST /start 并开始轮询
//   ④ 下载完成 → 显示"重启程序后生效"，并弹出提示条
// 用法：node data/test_update_ui.js
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.dirname(__dirname);
const PAGE = path.join(ROOT, "成绩分析工作台-首页.html");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  [OK]  " + name); }
  else { fail++; console.log("  [!!]  " + name + (detail ? "  → " + detail : "")); }
}
const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

function html() { return fs.readFileSync(PAGE, "utf8"); }

/** 造一个可控的假环境：可选注入启动器配置，可选拦截 fetch。 */
function boot(opts) {
  const calls = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(html(), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "http://127.0.0.1:3080/",
    beforeParse(w) {
      if (opts.launcher) {
        // 页面通过 window.parent.__WB_UPDATER__ 拿配置；jsdom 里 parent === window
        w.__WB_UPDATER__ = opts.launcher;
      }
      w.fetch = (url, init) => {
        calls.push({ url: String(url), init: init || {} });
        const handler = opts.fetch;
        if (!handler) return Promise.reject(new Error("no fetch stub"));
        const r = handler(String(url), init || {});
        return Promise.resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: () => Promise.resolve(r.body),
        });
      };
      w.open = (u) => { calls.push({ url: "OPEN " + u, init: {} }); return null; };
    },
  });
  return { dom, w: dom.window, doc: dom.window.document, calls, errors };
}

const LATEST = (ver) => ({
  status: 200,
  body: {
    tag_name: "v" + ver,
    name: "成绩分析工作台 V" + ver,
    published_at: "2026-10-18T02:00:00Z",
    body: "## 更新内容\n- 修了导入偶发失败\n- 设置里新增「更新」页",
    assets: [{
      name: "grade-analysis-workbench-v" + ver + "-windows-x64.zip",
      size: 201790060,
      browser_download_url: "https://github.com/Gusheng-GS/grade-analysis-workbench/releases/download/v" +
        ver + "/grade-analysis-workbench-v" + ver + "-windows-x64.zip",
    }],
  },
});

function openUpdateTab(doc, w) {
  const tab = [...doc.querySelectorAll(".tab")].find((t) => t.dataset.tab === "update");
  tab.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  return tab;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── ① 没有启动器 ──
  {
    const { w, doc, errors } = boot({});
    openUpdateTab(doc, w);
    await sleep(50);
    check("① 当前版本已显示", /0\.1\.\d+/.test(clean(doc.getElementById("updCurrent").textContent)),
          clean(doc.getElementById("updCurrent").textContent));
    check("① 检查更新按钮被禁用", doc.getElementById("updCheckBtn").disabled);
    check("① 提示说明为什么不可用",
          /启动\.bat/.test(clean(doc.getElementById("updStatus").textContent)));
    check("① 没有脚本错误", errors.length === 0, errors[0]);
    w.close();
  }

  // ── ② 已是最新版 ──
  {
    const launcher = { agent: "http://127.0.0.1:3099", token: "tk", version: "0.1.1",
                       repo: "Gusheng-GS/grade-analysis-workbench" };
    const { w, doc, calls, errors } = boot({
      launcher,
      fetch: (url) => {
        if (url.indexOf("/status") > 0) return { status: 200, body: { ok: true, download: {} } };
        if (url.indexOf("api.github.com") >= 0) return LATEST("0.1.1");
        return { status: 404, body: {} };
      },
    });
    openUpdateTab(doc, w);
    await sleep(80);
    doc.getElementById("updCheckBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(120);
    check("② 提示已是最新版", /已是最新版/.test(clean(doc.getElementById("updStatus").textContent)),
          clean(doc.getElementById("updStatus").textContent));
    check("② 不显示下载区", doc.getElementById("updLatest").style.display === "none");
    check("② 请求了 releases/latest",
          calls.some((c) => /releases\/latest/.test(c.url)));
    check("② 没有脚本错误", errors.length === 0, errors[0]);
    w.close();
  }

  // ── ③ 有新版本 + 开始下载 ──
  {
    const launcher = { agent: "http://127.0.0.1:3099", token: "tk", version: "0.1.1",
                       repo: "Gusheng-GS/grade-analysis-workbench" };
    let started = false;
    const { w, doc, calls, errors } = boot({
      launcher,
      fetch: (url, init) => {
        if (url.indexOf("/status") > 0) return { status: 200, body: { ok: true, download: {} } };
        if (url.indexOf("api.github.com") >= 0) return LATEST("0.2.0");
        if (url.indexOf("/start") > 0) {
          started = JSON.stringify(init.body || "");
          return { status: 202, body: { ok: true, file: "x.zip" } };
        }
        if (url.indexOf("/progress") > 0) {
          return { status: 200, body: { ok: true, busy: true, done: false, got: 1000, total: 4000 } };
        }
        return { status: 404, body: {} };
      },
    });
    openUpdateTab(doc, w);
    await sleep(80);
    doc.getElementById("updCheckBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(150);
    check("③ 显示最新版本号", /0\.2\.0/.test(clean(doc.getElementById("updLatestVer").textContent)),
          clean(doc.getElementById("updLatestVer").textContent));
    check("③ 显示安装包大小", /192\.5 MB|192\.4 MB|192 MB/.test(clean(doc.getElementById("updLatestAsset").textContent)),
          clean(doc.getElementById("updLatestAsset").textContent));
    check("③ 显示发布说明", /更新内容/.test(clean(doc.getElementById("updNotes").textContent)));
    check("③ 下载区可见", doc.getElementById("updLatest").style.display === "");

    doc.getElementById("updDownloadBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(150);
    check("③ 向代理 POST 了 /start", !!started, String(started));
    check("③ /start 带了下载地址", /releases\/download/.test(started || ""));
    check("③ 带上了 token 头",
          calls.some((c) => c.url.indexOf("/start") > 0 &&
            (c.init.headers || {})["X-WB-Token"] === "tk"));
    check("③ 开始轮询进度", calls.some((c) => c.url.indexOf("/progress") > 0));
    check("③ 进度文案出现",
          /正在下载/.test(clean(doc.getElementById("updProgressText").textContent)),
          clean(doc.getElementById("updProgressText").textContent));
    check("③ 没有脚本错误", errors.length === 0, errors[0]);
    w.close();
  }

  // ── ④ 下载完成 ──
  {
    const launcher = { agent: "http://127.0.0.1:3099", token: "tk", version: "0.1.1",
                       repo: "Gusheng-GS/grade-analysis-workbench" };
    const { w, doc, errors } = boot({
      launcher,
      fetch: (url, init) => {
        if (url.indexOf("/status") > 0) return { status: 200, body: { ok: true, download: {} } };
        if (url.indexOf("api.github.com") >= 0) return LATEST("0.2.0");
        if (url.indexOf("/start") > 0) return { status: 202, body: { ok: true } };
        if (url.indexOf("/progress") > 0) {
          return { status: 200, body: { ok: true, busy: false, done: true, got: 4000, total: 4000 } };
        }
        return { status: 404, body: {} };
      },
    });
    openUpdateTab(doc, w);
    await sleep(80);
    doc.getElementById("updCheckBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(150);
    doc.getElementById("updDownloadBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(250);
    const hint = clean(doc.getElementById("updDoneHint").textContent);
    check('④ 提示重启后生效', /重启程序后生效/.test(hint), hint);
    check("④ 完成提示可见", doc.getElementById("updDoneHint").style.display === "");
    check("④ 弹出提示条", !!doc.getElementById("updToast"),
          clean((doc.getElementById("updToast") || {}).textContent));
    check("④ 状态变为等待重启",
          /重启/.test(clean(doc.getElementById("updStatus").textContent)),
          clean(doc.getElementById("updStatus").textContent));
    check("④ 没有脚本错误", errors.length === 0, errors[0]);
    w.close();
  }

  console.log();
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) { console.log("===== 更新界面测试未通过 ====="); process.exit(1); }
  console.log("===== 更新界面测试全部通过 =====");
  process.exit(0);
})().catch((e) => { console.error("测试崩了:", e); process.exit(1); });
