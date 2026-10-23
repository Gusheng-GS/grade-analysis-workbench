// 更新代理的自动化测试：
//   · token 不对一律 403
//   · 只允许从白名单域名下载（测试用 --insecure-test 放行本地假服务器）
//   · 下载能落进 update\，进度回调正确，文件名被洗成 ASCII
//   · CORS 只回显 3080 的来源
// 用法：node data/test_update_agent.js
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.dirname(__dirname);
const AGENT = path.join(ROOT, "data", "update_agent.js");
const NODE = process.execPath;

const AGENT_PORT = 3097;
const APP_PORT = 3096;
const TOKEN = "test-token-" + Date.now().toString(36);

let pass = 0, fail = 0;
function ok(name) { pass++; console.log("  [OK]  " + name); }
function bad(name, detail) { fail++; console.log("  [!!]  " + name + (detail ? "  → " + detail : "")); }
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }
function eq(name, a, b) { check(name + " = " + JSON.stringify(b), a === b, "实际 " + JSON.stringify(a)); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({
      host: "127.0.0.1", port: AGENT_PORT, path: p, method,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        data ? { "Content-Length": data.length } : {},
        headers || {}
      ),
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // ── 准备：临时"程序目录" ──
  const TMPHOME = path.join(ROOT, "..", "build", "_tmp_update_agent");
  fs.rmSync(TMPHOME, { recursive: true, force: true });
  fs.mkdirSync(TMPHOME, { recursive: true });
  const home = fs.mkdtempSync(path.join(TMPHOME, "wb-upd-"));
  fs.mkdirSync(path.join(home, "update"), { recursive: true });
  fs.mkdirSync(path.join(home, "_开发文件"), { recursive: true });
  fs.writeFileSync(path.join(home, "version.txt"), "0.1.1\n", "utf8");

  // ── 假发布服务器：提供一个 1.5MB 的假 zip ──
  const payload = Buffer.alloc(1.5 * 1024 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
  let served = 0;
  const fileSrv = http.createServer((rq, rs) => {
    if (rq.url === "/redir.zip") {               // 重定向也要能跟
      rs.writeHead(302, { Location: "/pkg.zip" });
      return rs.end();
    }
    if (rq.url === "/pkg.zip") {
      served++;
      rs.writeHead(200, { "Content-Length": payload.length });
      // 分块发，方便观察进度
      let off = 0;
      const step = 256 * 1024;
      const timer = setInterval(() => {
        if (off >= payload.length) { clearInterval(timer); return rs.end(); }
        rs.write(payload.subarray(off, Math.min(off + step, payload.length)));
        off += step;
      }, 20);
      return;
    }
    rs.writeHead(404); rs.end();
  });
  await new Promise((r) => fileSrv.listen(APP_PORT, "127.0.0.1", r));

  // ── 起代理 ──
  // 注意：沙箱里 node 用管道抓子进程输出会 EPERM，所以把 stdout/stderr 重定向到文件
  const outFd = fs.openSync(path.join(home, "agent.out.log"), "w");
  const errFd = fs.openSync(path.join(home, "agent.err.log"), "w");
  const agent = spawn(NODE, [AGENT, "--home", home, "--port", String(AGENT_PORT),
    "--token", TOKEN, "--app-port", String(APP_PORT), "--insecure-test"],
    { stdio: ["ignore", outFd, errFd] });
  let agentErr = "";
  const readErr = () => {
    try { return fs.readFileSync(path.join(home, "agent.err.log"), "utf8").trim(); }
    catch (e) { return ""; }
  };

  // 等它就绪
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await req("GET", "/status", undefined, { "X-WB-Token": TOKEN });
      if (r.status === 200) { up = true; break; }
    } catch (e) {}
    await sleep(200);
  }
  check("代理能在 127.0.0.1:" + AGENT_PORT + " 起来", up, readErr().slice(0, 300));
  if (!up) { try { agent.kill(); } catch (e) {} process.exit(1); }

  // ── 1) 鉴权 ──
  let r = await req("GET", "/status");
  eq("不带 token 被拒", r.status, 403);
  r = await req("GET", "/status", undefined, { "X-WB-Token": "wrong" });
  eq("错 token 被拒", r.status, 403);
  r = await req("GET", "/status", undefined, { "X-WB-Token": TOKEN });
  eq("带对 token 能读状态", r.status, 200);
  eq("版本号来自 version.txt", r.json.version, "0.1.1");
  eq("一开始没有待安装包", r.json.staged.length, 0);

  // ── 2) CORS ──
  // 允许来源是由 --app-port 推出来的：测试里 APP_PORT=3096，所以放行的是 3096
  r = await req("OPTIONS", "/status", undefined, {
    Origin: "http://127.0.0.1:" + APP_PORT,
    "Access-Control-Request-Headers": "x-wb-token",
  });
  eq("预检返回 204", r.status, 204);
  eq("回显允许的来源", r.headers["access-control-allow-origin"], "http://127.0.0.1:" + APP_PORT);

  r = await req("OPTIONS", "/status", undefined, { Origin: "http://127.0.0.1:3081" });
  check("别的本机端口也不放行", !r.headers["access-control-allow-origin"]);

  r = await req("OPTIONS", "/status", undefined, { Origin: "http://evil.example" });
  check("不认识的来源不回 CORS 头", !r.headers["access-control-allow-origin"],
        JSON.stringify(r.headers["access-control-allow-origin"]));

  // ── 3) 拒绝坏地址 ──
  const H = { "X-WB-Token": TOKEN };
  r = await req("POST", "/start", { url: "http://evil.example/x.zip", name: "a.zip" }, H);
  eq("非白名单域名被拒", r.status, 400);
  r = await req("POST", "/start", { url: "ftp://github.com/x.zip", name: "a.zip" }, H);
  eq("非 http(s) 被拒", r.status, 400);
  r = await req("POST", "/start", {}, H);
  eq("缺 url 被拒", r.status, 400);

  // ── 4) 正常下载（带重定向 + 中文名 → 洗成 ASCII）──
  r = await req("POST", "/start", {
    url: "http://127.0.0.1:" + APP_PORT + "/redir.zip",
    name: "成绩分析工作台-v0.1.1-windows-x64.zip",
  }, H);
  eq("开始下载返回 202", r.status, 202);

  let prog = null;
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const s = await req("GET", "/progress", undefined, H);
    prog = s.json;
    if (prog.done || prog.error) break;
  }
  check("下载完成且无错误", prog && prog.done && !prog.error, prog && prog.error);
  eq("进度里带总字节数", prog.total, payload.length);
  eq("收到的字节数与文件一致", prog.got, payload.length);
  eq("文件名被洗成 ASCII", prog.file, "-v0.1.1-windows-x64.zip");

  const stagedPath = path.join(home, "update", prog.file);
  check("文件落进 update\\", fs.existsSync(stagedPath), stagedPath);
  if (fs.existsSync(stagedPath)) {
    const got = fs.readFileSync(stagedPath);
    eq("内容字节完全一致", Buffer.compare(got, payload), 0);
  }
  check("没有留下 .part 临时文件",
        fs.readdirSync(path.join(home, "update")).every((f) => !f.endsWith(".part")));

  r = await req("GET", "/status", undefined, H);
  eq("状态里能看到待安装包", r.json.staged.length, 1);

  // ── 5) 收尾 ──
  try { agent.kill(); } catch (e) {}
  try { fs.closeSync(outFd); fs.closeSync(errFd); } catch (e) {}
  fileSrv.close();
  try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}

  console.log();
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  if (fail) { console.log("===== 更新代理测试未通过 ====="); process.exit(1); }
  console.log("===== 更新代理测试全部通过 =====");
  process.exit(0);
})().catch((e) => {
  console.error("测试崩了:", e);
  process.exit(1);
});
