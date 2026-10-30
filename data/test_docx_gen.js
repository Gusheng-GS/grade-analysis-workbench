// -*- coding: utf-8 -*-
/**
 * docx 生成器自测：造一份带图、带表、带分页的小卷，写到临时目录，
 * 再用 python-docx（另一个脚本）把尺寸读回来核对。
 *
 * 跑法：node data/test_docx_gen.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const gen = require("./docx_gen.js");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const spec = {
  images: { a: PNG, b: PNG, c: PNG },
  blocks: [
    { t: "name", text: "张三" },
    { t: "h1", text: "化学反应速率与平衡 · 专项限时练" },
    { t: "sub", text: "高二 06 班 · 化学 · 共 1 题 · 满分 3 分 · 建议 20 分钟" },
    { t: "runs", runs: [{ text: "1．下列事实能用勒夏特列原理解释的是（3 分）" }] },
    {
      t: "runs", firstIndent: 24, runs: [
        { text: "D．" },
        { im: "a", w: 90, h: 12, down: 1 },
        { text: "，平衡时保持温度不变将容器的体积缩小至一半，新平衡的" },
        { im: "b", w: 14, h: 20, down: 3 },
        { text: "浓度与原平衡相同" }
      ]
    },
    { t: "table", rows: [
      [{ text: "实验" }, { text: "反应温度/℃" }, { text: "v/mL" }],
      [{ text: "①" }, { text: "25" }, { text: "0.1" }]
    ] },
    { t: "runs", runs: [{ im: "c", w: 480, h: 120 }] }
  ],
  answers: [
    { t: "h1", text: "答案与解析" },
    { t: "runs", runs: [{ text: "1．【单选7】答案：B" }] },
    { t: "runs", runs: [{ text: "D 错误。" }, { im: "a", w: 90, h: 12, down: 1 }] }
  ]
};

const buf = gen.buildDocx(spec);
const out = path.join(os.tmpdir(), "docx_gen_test.docx");
fs.writeFileSync(out, buf);
console.log("已生成", out, buf.length, "字节");

// 自查：zip 结构对不对（能不能被 node 的 zlib 读出来）
const names = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"];
const raw = buf.toString("latin1");
names.forEach(function (n) {
  if (raw.indexOf(n) < 0) { console.log("!! 缺条目", n); process.exit(1); }
});
console.log("OK 五个基础条目都在，图片条目", (raw.match(/word\/media\/image\d+\.png/g) || []).length, "个");
