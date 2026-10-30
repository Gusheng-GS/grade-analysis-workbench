// -*- coding: utf-8 -*-
/**
 * 测 docx_gen.js 的"浏览器分支"
 *
 * 做法：把源码丢进一个干净的 vm 上下文，里面只有 window / atob / TextEncoder，
 * 没有 Buffer、没有 module。跑出来的字节必须和 Node 分支**完全一样**——
 * 一样才说明页面里生成的 docx 和本地服务生成的是同一份东西。
 *
 * 用法：node data/test_docx_browser.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "docx_gen.js");
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
}

// 一张 1x1 的 PNG，够用来验证图片通道
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const spec = {
  blocks: [
    { t: "name", text: "张三" },
    { t: "h1", text: "测试卷" },
    { t: "runs", runs: [{ text: "1．这是" }, { im: "k1", w: 90, h: 23, down: 3 }, { text: "一道题（3 分）" }] },
    { t: "table", rows: [[{ text: "实验" }, { text: "温度" }], [{ text: "①" }, { text: "25" }]] },
    { t: "img", im: "k1", w: 240, h: 120 },
  ],
  answers: [{ t: "h1", text: "答案与解析（1 题）" }, { t: "runs", runs: [{ text: "1．【单选7】答案：B" }] }],
  images: { k1: PNG },
};

// ── 1. Node 分支 ──
delete require.cache[require.resolve(SRC)];
const nodeGen = require(SRC);
const nodeBuf = nodeGen.buildDocx(spec);
ok(nodeBuf.slice(0, 2).toString() === "PK", "Node 分支：输出是 ZIP（" + nodeBuf.length + " 字节）");

// ── 2. 浏览器分支：干净上下文 ──
const code = fs.readFileSync(SRC, "utf8");
const sandbox = {
  window: {},
  atob: function (b64) { return Buffer.from(b64, "base64").toString("binary"); },
  TextEncoder: TextEncoder,
  Uint8Array: Uint8Array,
  Int32Array: Int32Array,
  Math: Math,
  Date: Date,
  console: console,
};
vm.createContext(sandbox);
ok(typeof sandbox.Buffer === "undefined", "沙箱里确实没有 Buffer");
vm.runInContext(code, sandbox, { filename: "docx_gen.js" });
ok(sandbox.window.DocxGen && typeof sandbox.window.DocxGen.buildDocx === "function", "浏览器分支：window.DocxGen.buildDocx 存在");
ok(typeof sandbox.module === "undefined", "沙箱里确实没有 module（走的是浏览器分支）");

const webBuf = sandbox.window.DocxGen.buildDocx(spec);
ok(webBuf instanceof Uint8Array, "浏览器分支：返回 Uint8Array");
ok(webBuf.slice(0, 2)[0] === 0x50 && webBuf.slice(0, 2)[1] === 0x4b, "浏览器分支：输出是 ZIP");

// ── 3. 两边字节必须完全一致 ──
const a = Buffer.from(nodeBuf);
const b = Buffer.from(webBuf);
ok(a.length === b.length, "两条分支字节数一致（" + a.length + "）");
ok(a.equals(b), "两条分支字节完全相同");

// ── 4. 落盘，交给 python 再验一次 ──
const out = path.join(process.env.TEMP || ".", "docx_browser_test.docx");
fs.writeFileSync(out, webBuf);
console.log("  输出：" + out);

console.log("\n" + (fail ? "失败 " + fail + " 项" : "全部 " + pass + " 项通过"));
process.exit(fail ? 1 : 0);
