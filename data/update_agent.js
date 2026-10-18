// -*- coding: utf-8 -*-
/**
 * 更新代理（本地后台小进程）
 *
 * 为什么需要它：工作台页面跑在浏览器里，**没法把文件写进程序目录**。
 * 页面负责"查有没有新版"，真正的下载交给这个进程——它把 zip 放进
 * 交付目录的 update\ 里，启动器下次启动时 ApplyUpdate 会自动安装。
 *
 * 安全与边界：
 *   · 只监听 127.0.0.1（局域网访问不到）
 *   · 必须带启动器注入的 token（页面里能拿到，别的网站拿不到；再加 CORS 只放行 3080）
 *   · 只允许下载 github.com / *.githubusercontent.com 的地址（防止被使唤去下别的东西）
 *   · 只允许落到 <home>\update\ 下，文件名只留 [A-Za-z0-9._-]
 *
 * 启动（由启动器拉起，一般不需要手动跑）：
 *   node update_agent.js --home "D:\成绩分析工作台" --port 3099 --token abc123
 *
 * 自己退出：主程序（3080 端口）连续 60 秒不在监听，就认为程序已关闭，自己退出。
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");

// ─────────────────────────── 参数 ───────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const HOME = path.resolve(arg("home", __dirname)).replace(/[\\/]+$/, "");
const PORT = parseInt(arg("port", "3099"), 10);
const TOKEN = arg("token", "");
const APP_PORT = parseInt(arg("app-port", "3080"), 10);
// 仅测试用：放行 http 与 127.0.0.1（便于用本地假服务器跑自动化测试）。
// 正式启动（启动器拉起）永远不带这个开关。
const INSECURE_TEST = process.argv.indexOf("--insecure-test") >= 0;
const MAX_BYTES = 500 * 1024 * 1024;          // 单包上限 500MB
const ALLOW_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
];
if (INSECURE_TEST) ALLOW_HOSTS.push("127.0.0.1", "localhost");

const UPDATE_DIR = path.join(HOME, "update");
const ALLOWED_ORIGIN = [
  "http://127.0.0.1:" + APP_PORT,
  "http://localhost:" + APP_PORT,
];

function log(msg) {
  // 只写文件，不占用户的控制台（启动器是隐藏起来的）
  try {
    const line = new Date().toISOString() + "  " + msg + "\r\n";
    fs.appendFileSync(path.join(HOME, "_开发文件", "更新日志.txt"), line);
  } catch (e) { /* 日志失败不影响功能 */ }
}

function readVersion() {
  try {
    return fs.readFileSync(path.join(HOME, "version.txt"), "utf8").trim();
  } catch (e) {
    return "unknown";
  }
}

// ─────────────────────────── 进度状态 ───────────────────────────
const state = {
  busy: false,
  got: 0,
  total: 0,
  file: "",
  error: "",
  done: false,
};

function stagingFiles() {
  try {
    return fs.readdirSync(UPDATE_DIR)
      .filter((f) => /\.zip$/i.test(f))
      .map((f) => {
        let size = 0;
        try { size = fs.statSync(path.join(UPDATE_DIR, f)).size; } catch (e) {}
        return { name: f, size: size };
      });
  } catch (e) {
    return [];
  }
}

// ─────────────────────────── 下载 ───────────────────────────
/** 校验下载地址：https（测试模式可 http）+ 域名在允许名单里。返回 Error 或 null。 */
function validateUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return new Error("下载地址不合法"); }
  const okProto = INSECURE_TEST ? /^https?:$/.test(u.protocol) : u.protocol === "https:";
  if (!okProto) return new Error("只允许 https 下载");
  if (ALLOW_HOSTS.indexOf(u.hostname) < 0) {
    return new Error("不允许从这个域名下载：" + u.hostname);
  }
  return null;
}

/** 把用户/网页给的名字洗成安全的 zip 文件名（只留 ASCII）。 */
function safeName(rawName) {
  const safe = String(rawName || "").replace(/[^A-Za-z0-9._-]/g, "");
  let name = /\.zip$/i.test(safe) ? safe : (safe || "update") + ".zip";
  if (name.replace(/\.zip$/i, "").length < 1) name = "update.zip";
  return name;
}

function startDownload(url, rawName, cb) {
  if (state.busy) return cb(new Error("已经有一个下载在进行"));

  const bad = validateUrl(url);
  if (bad) return cb(bad);

  const u = new URL(url);
  const name = safeName(rawName);

  try { fs.mkdirSync(UPDATE_DIR, { recursive: true }); } catch (e) {}
  const partPath = path.join(UPDATE_DIR, name + ".part");
  const finalPath = path.join(UPDATE_DIR, name);

  state.busy = true; state.got = 0; state.total = 0; state.file = name;
  state.error = ""; state.done = false;
  log("开始下载 " + url + " → update\\" + name);

  function bail(err) {
    state.busy = false;
    state.error = err && err.message ? err.message : String(err);
    log("下载失败: " + state.error);
    try { fs.unlinkSync(partPath); } catch (e) {}
    cb(err);
  }

  function get(target, redirects) {
    if (redirects > 5) return bail(new Error("重定向次数过多"));
    const mod = target.protocol === "https:" ? https : http;
    const req = mod.get(target, {
      headers: { "User-Agent": "grade-analysis-workbench-updater" },
      timeout: 30000,
    }, (res) => {
      // 重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, target); } catch (e) { return bail(e); }
        // 重定向目标也要在允许名单里（GitHub 会跳到 objects.githubusercontent.com）
        if (target.protocol === "https:" && next.protocol !== "https:") {
          return bail(new Error("重定向到了非 https 地址"));
        }
        if (ALLOW_HOSTS.indexOf(next.hostname) < 0) {
          return bail(new Error("重定向到了不允许的域名：" + next.hostname));
        }
        return get(next, redirects + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return bail(new Error("HTTP " + res.statusCode));
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      if (total > MAX_BYTES) { res.resume(); return bail(new Error("文件太大")); }
      state.total = total;

      const out = fs.createWriteStream(partPath);
      res.on("data", (chunk) => {
        state.got += chunk.length;
        if (state.got > MAX_BYTES) { try { res.destroy(); } catch (e) {} }
      });
      res.on("error", bail);
      out.on("error", bail);
      out.on("finish", () => {
        if (state.got > MAX_BYTES) return bail(new Error("文件太大"));
        try {
          fs.renameSync(partPath, finalPath);
        } catch (e) { return bail(e); }
        state.busy = false;
        state.done = true;
        if (!state.total) state.total = state.got;
        log("下载完成 update\\" + name + "（" + state.got + " 字节），等待重启安装");
        cb(null, { name: name, size: state.got });
      });
      res.pipe(out);
    });
    req.on("timeout", () => { try { req.destroy(); } catch (e) {} bail(new Error("下载超时")); });
    req.on("error", bail);
  }

  get(u, 0);
}

// ─────────────────────────── HTTP ───────────────────────────
function send(res, code, obj, origin) {
  const body = JSON.stringify(obj);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  };
  if (origin && ALLOWED_ORIGIN.indexOf(origin) >= 0) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, x-wb-token";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Vary"] = "Origin";
  }
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 64 * 1024) { req.destroy(); return cb(new Error("请求体太大")); }
    chunks.push(c);
  });
  req.on("end", () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
    catch (e) { cb(e); }
  });
  req.on("error", cb);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    const headers = {};
    if (origin && ALLOWED_ORIGIN.indexOf(origin) >= 0) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "content-type, x-wb-token";
      headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      headers["Access-Control-Max-Age"] = "600";
    }
    res.writeHead(204, headers);
    return res.end();
  }

  // 非本方页面发起的请求一律拒绝（CORS 之外再加一道 token 校验）
  const tokenOk = !!TOKEN && req.headers["x-wb-token"] === TOKEN;
  if (!tokenOk) {
    return send(res, 403, { ok: false, error: "token 不对" }, origin);
  }

  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/status") {
    return send(res, 200, {
      ok: true,
      version: readVersion(),
      staged: stagingFiles(),
      download: { busy: state.busy, done: state.done, error: state.error, file: state.file },
    }, origin);
  }

  if (req.method === "GET" && url.pathname === "/progress") {
    return send(res, 200, {
      ok: true,
      busy: state.busy,
      done: state.done,
      got: state.got,
      total: state.total,
      file: state.file,
      error: state.error,
    }, origin);
  }

  if (req.method === "POST" && url.pathname === "/start") {
    return readBody(req, (err, body) => {
      if (err) return send(res, 400, { ok: false, error: "请求体解析失败" }, origin);
      if (!body || !body.url) return send(res, 400, { ok: false, error: "缺少 url" }, origin);
      if (state.busy) return send(res, 409, { ok: false, error: "已有一个下载在进行" }, origin);
      // 先同步校验，坏地址直接 400，不留给异步报错
      const bad = validateUrl(String(body.url));
      if (bad) return send(res, 400, { ok: false, error: bad.message }, origin);
      startDownload(String(body.url), String(body.name || ""), () => {});
      return send(res, 202, { ok: true, accepted: true, file: state.file }, origin);
    });
  }

  return send(res, 404, { ok: false, error: "没有这个接口" }, origin);
});

server.on("error", (e) => {
  log("代理启动失败: " + e.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  log("更新代理已启动 127.0.0.1:" + PORT + "（version=" + readVersion() + "）");
});

// ─────────────────────────── 生命周期 ───────────────────────────
/** 主程序挂了就别留着了。 */
function probeApp(cb) {
  const s = net.connect({ host: "127.0.0.1", port: APP_PORT }, () => {
    s.destroy();
    cb(true);
  });
  s.on("error", () => { s.destroy(); cb(false); });
  s.setTimeout(2000, () => { s.destroy(); cb(false); });
}

let deadSince = 0;
setInterval(() => {
  probeApp((alive) => {
    if (alive) { deadSince = 0; return; }
    if (!deadSince) deadSince = Date.now();
    // 程序还在启动中时别急着退（最多等 60 秒）
    else if (Date.now() - deadSince > 60000) {
      log("主程序已关闭，代理退出");
      process.exit(0);
    }
  });
}, 5000).unref();

if (!TOKEN) {
  log("没有拿到 token，代理拒绝提供服务");
  process.exit(2);
}
