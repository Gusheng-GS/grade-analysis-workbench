// 生成"三场考试"的演示数据（全部合成，姓名是 学生NN）。
// 用途：截图时能看到多次考试切换 + 名次趋势折线图。
// 输出：data/demo_exams_seed.json —— 内容正好是页面 localStorage 里
//       dsh-grade-workbench-v6-exams 的结构，由 make_demo_page.py 注入演示页。
//
// 用法：node data/make_demo_exams.js

const fs = require("fs");
const path = require("path");
const WuyueParse = require(path.join(__dirname, "wuyue_parse.js"));

const BASE = path.join(__dirname, "demo_home_data.json");
const OUT = path.join(__dirname, "demo_exams_seed.json");

const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
if (!base.学生 || !base.学生.length) throw new Error("demo_home_data.json 里没有学生");

// ── 三次考试：日期/名称/整体水平都不同，看起来才像真的历次考试 ──
const EXAMS = [
  { name: "高二08月考", date: "2026-08-21", factor: 0.955, seed: 20260821 },
  { name: "高二09月考", date: "2026-09-20", factor: 1.0, seed: 20260920 },
  { name: "高二10月考", date: "2026-10-15", factor: 1.028, seed: 20261015 },
];

/** 确定性随机（同一个种子每次结果一样，方便重复截图）。 */
function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = WuyueParse.pyRound1;
const subjects = (base.班级 && base.班级.科目) || Object.keys(base.学生[0].各科);

// 各科的"观察到的最高分"，用来当上限，避免造出比满分还高的分数
const cap = {};
subjects.forEach(function (sub) {
  let m = 0;
  base.学生.forEach(function (s) {
    const v = Number(s.各科[sub]);
    if (!isNaN(v) && v > m) m = v;
  });
  cap[sub] = m || 100;
});

const records = EXAMS.map(function (cfg, idx) {
  const rand = rng(cfg.seed);
  const data = JSON.parse(JSON.stringify(base));   // 深拷贝
  data.考试 = Object.assign({}, base.考试, { 名称: cfg.name, 日期: cfg.date });

  data.学生.forEach(function (s) {
    let sum = 0;
    subjects.forEach(function (sub) {
      const v0 = Number(s.各科[sub]);
      if (isNaN(v0)) return;
      // 整体水平 × 系数 + 每人每科的小抖动（±2.5）
      const jitter = (rand() - 0.5) * 5;
      let v = v0 * cfg.factor + jitter;
      if (v < 0) v = 0;
      if (v > cap[sub]) v = cap[sub];
      v = round1(v);
      s.各科[sub] = v;
      sum += v;
    });
    s.总分 = round1(sum);
  });

  // 重算班名次 / 概况 / 科目统计 / 待复核（用与页面同一个函数，保证口径一致）
  WuyueParse.recomputeAggregates(data);

  return {
    id: "demo-e" + (idx + 1),
    name: cfg.name,
    date: cfg.date,
    school: data.考试.学校,
    className: data.班级.名称,
    track: data.班级.选科,
    subjects: subjects.slice(),
    importedAt: Date.parse(cfg.date + "T18:00:00").valueOf(),
    files: [],
    data: data,
  };
});

const seed = {
  version: 1,
  exams: records,
  selectedExamIds: records.map(function (r) { return r.id; }),
  // 主考试 = 最近一次（页面右侧、学生列表都按它显示）
  primaryExamId: records[records.length - 1].id,
  savedAt: 1760000000000,
};

fs.writeFileSync(OUT, JSON.stringify(seed), "utf8");

console.log("已生成", path.basename(OUT));
records.forEach(function (r) {
  const g = r.data.概况;
  console.log(
    "  " + r.name + "（" + r.date + "）均分 " + g.总分均分 +
    "  最高 " + g.总分最高 + "  最低 " + g.总分最低
  );
});
console.log("  大小:", (fs.statSync(OUT).size / 1024).toFixed(1), "KB");
