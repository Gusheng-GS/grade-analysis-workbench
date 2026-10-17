/* 端到端测试：分析台右栏的"学生表现分析 + 折线图"和"班级趋势图"
 *
 * 跑法（项目根目录）： node data/test_charts_e2e.js
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'home_data.json'), 'utf8'));

const fails = [];
function check(label, cond, extra) {
  console.log(`${cond ? '[OK]  ' : '[FAIL]'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(label);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

/** 造一次考试：每科 +bump，日期/名称按参数给。 */
function examData(src, name, date, bump) {
  const d = clone(src);
  d.考试.名称 = name;
  d.考试.日期 = date;
  d.学生 = d.学生.map(s => {
    const sub = {};
    Object.keys(s.各科).forEach(k => { sub[k] = Math.round((s.各科[k] + bump) * 10) / 10; });
    return Object.assign({}, s, { 各科: sub, 总分: Math.round(Object.values(sub).reduce((a, b) => a + b, 0) * 10) / 10 });
  });
  return d;
}

const html = fs.readFileSync(path.join(ROOT, '成绩分析工作台-首页.html'), 'utf8');
function load() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test((e && e.message) || '')) errors.push((e && e.message) || ''); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1:3080/' });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  return { w, errors };
}

(async () => {
  const { w, errors } = load();
  await new Promise(r => setTimeout(r, 250));
  const $ = s => w.document.querySelector(s);
  const txt = s => ($(s) || {}).textContent || '';

  check('页面加载无报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  // 三次考试：09月 -> 10月(+10) -> 11月(+5)
  w.eval(`addExam(${JSON.stringify(clone(REF))}, ['a.xlsx']);`);
  w.eval(`addExam(${JSON.stringify(examData(REF, '10月月考', '2026-10-20', 10))}, ['b.xlsx']);`);
  w.eval(`addExam(${JSON.stringify(examData(REF, '11月月考', '2026-11-20', 5))}, ['c.xlsx']);`);
  await new Promise(r => setTimeout(r, 150));
  check('三次考试都导入了', w.eval('state.exams.length') === 3);

  // ── ① 点学生 → 右栏换成该生分析 ──
  console.log('\n===== ① 点学生姓名，右栏切到该生分析 =====');
  const firstRow = w.document.querySelector('#stuList .stu[data-i]');
  const target = w.eval('DATA.学生[0].姓名');
  firstRow.click();
  await new Promise(r => setTimeout(r, 120));

  check('记住了选中的学生', w.eval('state.anStudent') === target, String(w.eval('state.anStudent')));
  check('班级视图被隐藏', w.document.getElementById('classView').style.display === 'none');
  check('学生视图显示出来', w.document.getElementById('stuView').style.display !== 'none');
  const sv = txt('#stuView');
  check('显示出该生姓名', sv.includes(target));
  check('显示总分与班名次', sv.includes('总分') && sv.includes('班名次'));
  check('有各科对比表', sv.includes('全班均分') && sv.includes('相差'));
  check('有历次考试表', sv.includes('历次考试') && sv.includes('10月月考') && sv.includes('11月月考'));

  // ── ② 图表 ──
  console.log('\n===== ② 折线图 =====');
  const svgs = w.document.querySelectorAll('#stuView svg.chart');
  check('画出了两张折线图（总分 + 名次）', svgs.length === 2, '实际 ' + svgs.length);
  const caps = Array.from(w.document.querySelectorAll('#stuView .chart-cap')).map(e => e.textContent);
  check('图有标题（总分 / 班名次）', caps.some(c => c.includes('总分')) && caps.some(c => c.includes('班名次')), caps.join(' | '));
  const pts0 = svgs[0] ? svgs[0].querySelectorAll('.pt').length : 0;
  const pts1 = svgs[1] ? svgs[1].querySelectorAll('.pt').length : 0;
  check('总分图有 3 个数据点', pts0 === 3, String(pts0));
  check('名次图有 3 个数据点', pts1 === 3, String(pts1));
  check('折线已连线', svgs[0] && svgs[0].querySelectorAll('polyline').length >= 1,
    svgs[0] ? String(svgs[0].querySelectorAll('polyline').length) : '');
  check('x 轴标了日期', svgs[0] && svgs[0].textContent.includes('09-20') && svgs[0].textContent.includes('11-20'),
    svgs[0] ? svgs[0].textContent.replace(/\s+/g, ' ').slice(0, 60) : '');

  // 悬停提示
  const aPt = svgs[0].querySelector('.pt');
  check('数据点带悬停文字', !!(aPt && aPt.dataset.tip), aPt ? aPt.dataset.tip.split('\n')[0] : '');
  check('悬停文字含考试与分数', aPt && aPt.dataset.tip.includes('09月考') && aPt.dataset.tip.includes('总分'), '');
  check('默认不显示提示', w.document.getElementById('chartTip').style.display === 'none');
  aPt.dispatchEvent(new w.MouseEvent('mouseenter', { bubbles: false }));
  await new Promise(r => setTimeout(r, 30));
  const tip = w.document.getElementById('chartTip');
  check('悬停后提示出现', tip.style.display !== 'none');
  check('提示里有那次考试的具体信息', tip.innerHTML.includes('总分') && tip.innerHTML.includes('班名次') &&
    tip.innerHTML.includes('语文'), tip.textContent.replace(/\s+/g, ' ').slice(0, 80));
  aPt.dispatchEvent(new w.MouseEvent('mouseleave', { bubbles: false }));
  check('移开鼠标后提示隐藏', tip.style.display === 'none');

  // ── ③ 切回全班 ──
  console.log('\n===== ③ 点「全体」回到班级视图 + 班级趋势图 =====');
  w.document.getElementById('classTotalItem').click();
  await new Promise(r => setTimeout(r, 120));
  check('清掉了学生选择', w.eval('state.anStudent') === null);
  check('班级视图回来了', w.document.getElementById('classView').style.display !== 'none');
  check('学生视图隐藏', w.document.getElementById('stuView').style.display === 'none');
  const trend = w.document.getElementById('classTrend');
  check('出现班级趋势区', trend.style.display !== 'none');
  const cSvgs = trend.querySelectorAll('svg.chart');
  check('班级趋势有两张图（总分均分 + 各科均分）', cSvgs.length === 2, String(cSvgs.length));
  check('各科图是多条线', cSvgs[1] && cSvgs[1].querySelectorAll('polyline').length === 6,
    cSvgs[1] ? cSvgs[1].querySelectorAll('polyline').length + ' 条' : '');
  const legend = trend.querySelectorAll('.chart-legend span').length;
  check('有 6 个科目的图例', legend === 6, String(legend));
  const cPt = cSvgs[0].querySelector('.pt');
  cPt.dispatchEvent(new w.MouseEvent('mouseenter', { bubbles: false }));
  check('班级图也能悬停看详情',
    w.document.getElementById('chartTip').innerHTML.includes('总分均分'));

  // ── ④ 只勾一次考试 ──
  console.log('\n===== ④ 只勾选一次考试时给提示、不画空图 =====');
  const ids = w.eval('state.exams.map(e => e.id)');
  w.eval(`setExamSelected(${JSON.stringify(ids[0])}, false); setExamSelected(${JSON.stringify(ids[1])}, false);`);
  await new Promise(r => setTimeout(r, 120));
  check('只剩一次勾选', w.eval('state.selectedExamIds.length') === 1);
  check('班级趋势区隐藏', w.document.getElementById('classTrend').style.display === 'none');
  w.document.querySelector('#stuList .stu[data-i]').click();
  await new Promise(r => setTimeout(r, 100));
  check('学生视图给出"勾选更多考试"的提示',
    txt('#stuView').includes('画不出趋势') || txt('#stuView').includes('多勾几次'),
    txt('#stuView').replace(/\s+/g, ' ').slice(-90));
  check('此时不画折线图', w.document.querySelectorAll('#stuView svg.chart').length === 0);
  w.eval(`setExamSelected(${JSON.stringify(ids[0])}, true); setExamSelected(${JSON.stringify(ids[1])}, true);`);

  // ── ⑤ 缺考要断开 ──
  console.log('\n===== ⑤ 某次没参加：线要断开，不能连成直线 =====');
  // 再加一次考试，然后把这个学生从第 3 次里删掉（4 次里缺一次）
  w.eval(`addExam(${JSON.stringify(examData(REF, '12月月考', '2026-12-20', 20))}, ['d.xlsx']);`);
  await new Promise(r => setTimeout(r, 100));
  const missName = w.eval('DATA.学生[0].姓名');
  w.eval('(function(){ var e = state.exams[2];' +
    ' e.data.学生 = e.data.学生.filter(function(s){ return s.姓名 !== ' + JSON.stringify(missName) + '; });' +
    ' })();');
  w.eval('setPrimaryExam(state.exams[3].id)');
  await new Promise(r => setTimeout(r, 80));
  w.eval('state.anStudent = ' + JSON.stringify(missName));
  w.eval('renderAnalyzePanel()');
  await new Promise(r => setTimeout(r, 100));
  const svgT = w.document.querySelector('#stuView svg.chart');
  const missPts = svgT ? svgT.querySelectorAll('.pt').length : 0;
  check('缺考那次没有数据点（4 次里只画 3 个点）', missPts === 3, String(missPts));
  check('历次表里标明未参加', txt('#stuView').includes('未参加'), '');
  // 4 点缺中间那个：应当分成两段，不能一条线连过去
  const polylines = svgT ? svgT.querySelectorAll('polyline').length : 0;
  check('线被断开（不是一条完整折线）', polylines <= 1, String(polylines) + ' 段');

  console.log('');
  if (fails.length) {
    console.log(`!! 失败项 ${fails.length} 个：`);
    fails.forEach(f => console.log('   -', f));
    process.exit(1);
  }
  console.log('===== 图表功能测试通过 =====');
})().catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
