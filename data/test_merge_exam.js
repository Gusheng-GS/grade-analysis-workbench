/* 验证"补充数据"（合并）逻辑：把真实数据切开再合回去，应该和原来一模一样。
 *
 * 跑法（项目根目录）： node data/test_merge_exam.js
 *
 * 为什么这么测：合并是"往已有考试里补学生/补科目/更正分数"的底层操作，
 * 算错了老师看到的名次和均分就全错。用"切开-合回"来验，比手写期望值可靠得多。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const W = require(path.join(ROOT, 'data', 'wuyue_parse.js'));
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'home_data.json'), 'utf8'));

const fails = [];
function check(label, cond, extra) {
  console.log(`${cond ? '[OK]  ' : '[FAIL]'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(label);
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

/** 造一份"只含部分学生"的数据（各科完整），总分按各科之和重算。 */
function halfByStudent(src, from, to) {
  const d = clone(src);
  d.学生 = d.学生.slice(from, to).map(s => {
    const t = Object.values(s.各科).reduce((a, b) => a + b, 0);
    return Object.assign({}, s, { 总分: W.pyRound1(t) });
  });
  return W.recomputeAggregates(d);
}

/** 造一份"只含部分科目"的数据。 */
function halfBySubject(src, subjects) {
  const d = clone(src);
  d.学生 = d.学生.map(s => {
    const sub = {};
    subjects.forEach(k => { if (s.各科[k] !== undefined) sub[k] = s.各科[k]; });
    const t = Object.values(sub).reduce((a, b) => a + b, 0);
    return Object.assign({}, s, { 各科: sub, 总分: W.pyRound1(t) });
  });
  d.班级.科目 = subjects.slice();
  return W.recomputeAggregates(d);
}

// ── ① 按学生切分再合并 ──
console.log('===== ① 按学生切分（20 + 20）再合并 =====');
const base1 = halfByStudent(REF, 0, 20);
const inc1 = halfByStudent(REF, 20, 40);
const base1Copy = JSON.stringify(base1);
const inc1Copy = JSON.stringify(inc1);
const merged1 = W.mergeExamData(base1, inc1);

check('合并后人数回到 40', merged1.学生.length === 40, '实际 ' + merged1.学生.length);
check('总分均分与原数据一致', merged1.概况.总分均分 === REF.概况.总分均分,
  merged1.概况.总分均分 + ' vs ' + REF.概况.总分均分);
check('最高/最低分一致',
  merged1.概况.总分最高 === REF.概况.总分最高 && merged1.概况.总分最低 === REF.概况.总分最低);
check('科目均分全部一致',
  JSON.stringify(merged1.科目统计) === JSON.stringify(REF.科目统计));

let rosterOk = true, firstBad = '';
for (let i = 0; i < REF.学生.length; i++) {
  const a = merged1.学生[i], b = REF.学生[i];
  if (a.姓名 !== b.姓名 || a.总分 !== b.总分 || a.班名次 !== b.班名次 ||
      JSON.stringify(a.各科) !== JSON.stringify(b.各科)) {
    rosterOk = false;
    firstBad = `第${i + 1}名 ${a.姓名}(${a.总分}) vs ${b.姓名}(${b.总分})`;
    break;
  }
}
check('每个学生的姓名/各科/总分/名次都与原数据一致', rosterOk, firstBad);
check('合并不会改动传入的数据', JSON.stringify(base1) === base1Copy && JSON.stringify(inc1) === inc1Copy);

// ── ② 按科目切分再合并（模拟"先导了三科，后来补齐另外三科"）──
console.log('\n===== ② 按科目切分（语文数学英语 + 物理化学地理）再合并 =====');
const base2 = halfBySubject(REF, ['语文', '数学', '英语']);
const inc2 = halfBySubject(REF, ['物理', '化学', '地理']);
const merged2 = W.mergeExamData(base2, inc2);

check('每个学生补齐到 6 科', merged2.学生.every(s => Object.keys(s.各科).length === 6),
  '第一个学生: ' + Object.keys(merged2.学生[0].各科).join('/'));
const totalOk = merged2.学生.every((s, i) => {
  const ref = REF.学生.find(x => x.姓名 === s.姓名);
  return ref && s.总分 === ref.总分;
});
check('补齐后总分与原数据一致（说明"总分=各科之和"成立）', totalOk,
  totalOk ? '' : (merged2.学生[0].总分 + ' vs ' + REF.学生.find(x => x.姓名 === merged2.学生[0].姓名).总分));
check('补齐后科目统计与原数据一致', JSON.stringify(merged2.科目统计) === JSON.stringify(REF.科目统计));
// 名次：总分必须对得上，且名次随总分单调（同分并列时先后可能和原数据不同 ——
// 因为"先导了三科"的那份数据自己排过一次序，同分学生的相对顺序以它为准）
{
  const byName = {};
  merged2.学生.forEach(s => { byName[s.姓名] = s; });
  const totalsOk = REF.学生.every(r => byName[r.姓名] && byName[r.姓名].总分 === r.总分);
  let mono = true;
  for (let i = 1; i < merged2.学生.length; i++) {
    if (merged2.学生[i].总分 > merged2.学生[i - 1].总分) mono = false;
  }
  const sameNames = JSON.stringify(merged2.学生.map(s => s.姓名).slice().sort()) ===
    JSON.stringify(REF.学生.map(s => s.姓名).slice().sort());
  check('补齐后每人的总分与原数据一致', totalsOk);
  check('补齐后名次随总分单调排列', mono);
  check('补齐后学生名单与原数据一致', sameNames);
  // 同分并列时只允许相邻名次互换
  let rankOk = true;
  const refRank = {};
  REF.学生.forEach(s => { refRank[s.姓名] = s.班名次; });
  merged2.学生.forEach((s, i) => {
    if (Math.abs((i + 1) - refRank[s.姓名]) > 1) rankOk = false;
  });
  check('同分并列最多影响相邻名次', rankOk);
}

// ── ③ 追加新学生 ──
console.log('\n===== ③ 补充一个新学生 =====');
const inc3 = clone(inc1);
inc3.学生.push({
  考号: '9999999999', 姓名: '新同学', 选科: '物化地', 总分: 0,
  各科: { 语文: 90, 数学: 90, 英语: 90, 物理: 60, 化学: 60, 地理: 60 },
});
const merged3 = W.mergeExamData(base1, inc3);
const added = merged3.学生.find(s => s.姓名 === '新同学');
check('新学生进来了', !!added);
check('新学生人数 41', merged3.学生.length === 41, '实际 ' + merged3.学生.length);
check('新学生总分按各科之和 = 450', added && added.总分 === 450, added ? String(added.总分) : '');
check('新学生名次落在总分对应的位置', added && merged3.学生[added.班名次 - 1].姓名 === '新同学');

// ── ④ 更正分数（同一学生，新数据覆盖旧数据）──
//    注意：要用"包含同一个学生"的两份数据，否则测的是"换人"而不是"改分"
console.log('\n===== ④ 更正某个学生的分数 =====');
const base4 = clone(base1);
const target = base4.学生[0].姓名;
const inc4 = clone(base1);                       // 同一批学生（会与 base 配对）
const t4 = inc4.学生.find(s => s.姓名 === target);
t4.各科 = Object.assign({}, t4.各科, { 数学: 150 });
t4.总分 = W.pyRound1(Object.values(t4.各科).reduce((a, b) => a + b, 0));
const merged4 = W.mergeExamData(base4, inc4);
const fixed = merged4.学生.find(s => s.姓名 === target);
check('更正后的分数生效', fixed && fixed.各科.数学 === 150, fixed ? String(fixed.各科.数学) : '');
check('其它科目没被抹掉', fixed && Object.keys(fixed.各科).length === 6);
check('人数没有因为更正而变多', merged4.学生.length === 20, '实际 ' + merged4.学生.length);
check('更正之后总分跟着更新', fixed && fixed.总分 === merged4.学生.find(s => s.姓名 === target).总分 &&
  fixed.总分 > REF.学生.find(s => s.姓名 === target).总分,
  fixed ? String(fixed.总分) : '');

// ── ⑤ 空数据兜底 ──
console.log('\n===== ⑤ 边界情况 =====');
const mergedEmpty = W.mergeExamData(W.empty(), clone(REF));
check('空 + 数据 = 数据', mergedEmpty.学生.length === 40 && mergedEmpty.概况.总分均分 === REF.概况.总分均分);
const mergedIntoEmpty = W.mergeExamData(clone(REF), W.empty());
check('数据 + 空 = 数据', mergedIntoEmpty.学生.length === 40);

console.log('');
if (fails.length) {
  console.log(`!! 失败项 ${fails.length} 个：`);
  fails.forEach(f => console.log('   -', f));
  process.exit(1);
}
console.log('===== 合并逻辑测试通过 =====');
