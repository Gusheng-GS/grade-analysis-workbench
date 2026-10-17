/* 用真实五岳文件验证 JS 解析结果 == Python 生成的 home_data.json
 *
 * 跑法（在项目根目录）：
 *   node data/test_parse_parity.js
 *
 * 为什么这个测试是关键：它拿 Python 版（已通过 240 人次校验）当参考答案，
 * 逐字段比对 JS 版。只要这个过，网页里导入出来的数据就和之前烤进页面的那份
 * 完全一样，不会出现"换了个入口结果数字变了"。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const XLSX = require('xlsx');
const WuyueParse = require(path.join(ROOT, 'data', 'wuyue_parse.js'));

const SRC = path.join(__dirname, 'fixtures', 'wuyue-export');

const FILES = {
  detail: '06_各科小题分.xlsx',
  analysis: '06_各科试题分析.xlsx',
  official: '06_学生成绩(方向名次).xlsx',
};

// 两边都从导出文件里推导元信息（学校/班级/考试名/日期），所以这里不用覆盖
const META = {};

const fails = [];
const notes = [];

function eq(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

function diff(pathStr, js, py) {
  if (Array.isArray(js) || Array.isArray(py)) {
    if (!Array.isArray(js) || !Array.isArray(py)) {
      fails.push(`${pathStr}: 类型不同 JS=${Array.isArray(js) ? 'array' : typeof js} PY=${Array.isArray(py) ? 'array' : typeof py}`);
      return;
    }
    if (js.length !== py.length) {
      fails.push(`${pathStr}: 长度不同 JS=${js.length} PY=${py.length}`);
      return;
    }
    for (let i = 0; i < js.length; i++) diff(`${pathStr}[${i}]`, js[i], py[i]);
    return;
  }
  if (js && py && typeof js === 'object' && typeof py === 'object') {
    const keys = new Set([...Object.keys(js), ...Object.keys(py)]);
    for (const k of keys) {
      if (!(k in js)) { fails.push(`${pathStr}.${k}: JS 里没有（PY=${JSON.stringify(py[k])}）`); continue; }
      if (!(k in py)) { fails.push(`${pathStr}.${k}: PY 里没有（JS=${JSON.stringify(js[k])}）`); continue; }
      diff(`${pathStr}.${k}`, js[k], py[k]);
    }
    return;
  }
  if (!eq(js, py)) fails.push(`${pathStr}: JS=${JSON.stringify(js)}  PY=${JSON.stringify(py)}`);
}

console.log('读取三个 xlsx…');
const wbs = {};
for (const [kind, fname] of Object.entries(FILES)) {
  const fp = path.join(SRC, fname);
  if (!fs.existsSync(fp)) { console.error('找不到文件:', fp); process.exit(1); }
  wbs[kind] = XLSX.readFile(fp, { cellDates: false });
  console.log(`  ${kind.padEnd(9)} ${fname}  工作表: ${wbs[kind].SheetNames.join('、')}`);
}

console.log('\n解析…');
const jsData = WuyueParse.build(XLSX, wbs, META);

// 文件识别函数也顺手验一下
for (const [kind, fname] of Object.entries(FILES)) {
  const got = WuyueParse.classifyFileName(fname);
  if (got !== kind) fails.push(`classifyFileName(${fname}) => ${got}，应为 ${kind}`);
}

const pyData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'home_data.json'), 'utf8'));

console.log('\n比对（JS 移植版 vs Python 参考版）…');
diff('DATA', jsData, pyData);

// 几个关键量单独打出来，方便一眼确认
console.log(`  学生数     JS=${jsData.学生.length}  PY=${pyData.学生.length}`);
console.log(`  总分均分   JS=${jsData.概况.总分均分}  PY=${pyData.概况.总分均分}`);
console.log(`  科目统计   JS=${jsData.科目统计.map(s => s.科目 + ':' + s.均分).join(' ')}`);
console.log(`             PY=${pyData.科目统计.map(s => s.科目 + ':' + s.均分).join(' ')}`);
console.log(`  最该讲的题 JS=${jsData.最该讲的题.length} 条  PY=${pyData.最该讲的题.length} 条`);
console.log(`    前3题    JS=${jsData.最该讲的题.slice(0, 3).map(x => x.科目 + x.题号 + '(' + x.得分率 + '%)').join(' ')}`);
console.log(`             PY=${pyData.最该讲的题.slice(0, 3).map(x => x.科目 + x.题号 + '(' + x.得分率 + '%)').join(' ')}`);
console.log(`  班名次前5  JS=${jsData.学生.slice(0, 5).map(s => s.姓名 + ':' + s.总分).join(' ')}`);
console.log(`             PY=${pyData.学生.slice(0, 5).map(s => s.姓名 + ':' + s.总分).join(' ')}`);

// 同分并列的名次先后也要一致（稳定排序）
const ties = jsData.学生.map((s, i) => [s.总分, s.姓名, pyData.学生[i] && pyData.学生[i].姓名]);
const badTies = ties.filter(t => t[1] !== t[2]);
console.log(`  同分顺序   ${badTies.length === 0 ? '一致' : '有 ' + badTies.length + ' 处不一致'}`);

console.log('');
if (fails.length) {
  console.log(`!! 有 ${fails.length} 处不一致：`);
  fails.slice(0, 40).forEach(f => console.log('   -', f));
  process.exit(1);
}
console.log('===== 一致：JS 移植版输出与 Python 参考版完全相同 =====');
