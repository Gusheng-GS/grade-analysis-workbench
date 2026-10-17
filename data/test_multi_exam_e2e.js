/* 端到端测试：多考试（隔离存储 / 勾选参与分析 / 主考试 / 补充数据 / 对比）
 *
 * 跑法（项目根目录）： node data/test_multi_exam_e2e.js
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');

const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'home_data.json'), 'utf8'));
const LS_EXAMS_KEY = 'dsh-grade-workbench-v6-exams';
const LS_DATA_KEY = 'dsh-grade-workbench-v6-data';

const fails = [];
function check(label, cond, extra) {
  console.log(`${cond ? '[OK]  ' : '[FAIL]'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(label);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

/** 造"下一次考试"：每科 +10 分（各科与总分同步），日期往后推一个月。 */
function nextExamData(src, name, date, bump) {
  const d = clone(src);
  d.考试.名称 = name;
  d.考试.日期 = date;
  d.学生 = d.学生.map(s => {
    const sub = {};
    Object.keys(s.各科).forEach(k => { sub[k] = Math.round((s.各科[k] + bump) * 10) / 10; });
    const total = Math.round(Object.values(sub).reduce((a, b) => a + b, 0) * 10) / 10;
    return Object.assign({}, s, { 各科: sub, 总分: total });
  });
  return d;
}

const html = fs.readFileSync(path.join(ROOT, '成绩分析工作台-首页.html'), 'utf8');
function load(inject) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test((e && e.message) || '')) errors.push((e && e.message) || ''); });
  const dom = new JSDOM(inject ? html.replace('<head>', '<head>' + inject) : html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1:3080/',
  });
  const w = dom.window;
  w.alert = () => {}; w.confirm = () => true;
  return { w, errors };
}

(async () => {
  const T_CODE = '学生' + String(REF.学生[0].班名次).padStart(2, '0');
const T_NAME = REF.学生[0].姓名;
const { w, errors } = load();
  await new Promise(r => setTimeout(r, 250));
  const txt = s => (w.document.querySelector(s) || {}).textContent || '';

  // ── ① 导入两次考试 ──
  console.log('===== ① 导入两次考试（数据隔离）=====');
  const e1 = clone(REF);
  const e2 = nextExamData(REF, '10月月考', '2026-10-20', 10);
  w.eval(`addExam(${JSON.stringify(e1)}, ['第一次.xlsx']);`);
  await new Promise(r => setTimeout(r, 100));
  w.eval(`addExam(${JSON.stringify(e2)}, ['第二次.xlsx']);`);
  await new Promise(r => setTimeout(r, 100));

  check('左栏列出两次考试', w.document.querySelectorAll('#examList .exam-row').length === 2);
  check('两次考试数据互相独立', w.eval(`state.exams[0].data.学生[0].总分 !== state.exams[1].data.学生[0].总分`));
  check('第一次的数据没被第二次改掉',
    w.eval(`state.exams[0].data.概况.总分均分 === ${REF.概况.总分均分}`),
    String(w.eval('state.exams[0].data.概况.总分均分')));
  check('当前主考试是最新导入的那次', w.eval('primaryExam().name') === '10月月考', String(w.eval('primaryExam().name')));
  check('两次都默认勾选参与分析', w.eval('state.selectedExamIds.length') === 2);
  check('DATA 等于主考试的数据', w.eval('DATA.考试.名称') === '10月月考');

  // ── ② 界面上的对比 ──
  console.log('\n===== ② 界面上体现对比 =====');
  const tags = w.document.querySelectorAll('#stuList .delta').length;
  check('学生列表出现分差标签', tags === 40, '实际 ' + tags + ' 个');
  const firstTag = (w.document.querySelector('#stuList .delta') || {}).textContent || '';
  // 每科 +10、共 6 科 → 总分 +60，所以标签是 ↑60（比的是总分变化）
  check('分差方向正确（总分 +60）', firstTag.includes('↑') && firstTag.includes('60'), firstTag);
  check('右栏出现"多次考试对比"', txt('#examCompare').includes('多次考试对比'),
    txt('#examCompare').replace(/\s+/g, ' ').slice(0, 60));
  check('对比表列了两次考试', txt('#examCompare').includes('09月考') && txt('#examCompare').includes('10月月考'),
    txt('#examCompare').replace(/\s+/g, ' ').slice(0, 120));
  check('对比表含各科均分变化', txt('#examCompare').includes('各科均分变化'));

  // ── ③ AI 上下文带上多次考试 ──
  console.log('\n===== ③ 勾选的考试进入 AI 上下文 =====');
  const ctx = w.eval(`multiExamContext('同学01')`);
  check('上下文含"多次考试对比"', ctx.includes('多次考试对比'));
  check('上下文含两次考试名', ctx.includes('09月考') && ctx.includes('10月月考'));
  check('上下文含该生各次成绩', ctx.includes('该生各次考试') && ctx.includes('总分变化'));
  check('上下文标出了主考试', ctx.includes('当前主考试'));

  let sentBody = null;
  w.fetch = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '好的' } }] }) };
  };
  w.eval(`state.keys = [{id:'k1', name:'k', value:'sk-x'}]; state.settings.defaultKeyId='k1';`);
  // 提问里点名一个学生，才能验证"学生的跨考试数据"和"姓名脱敏"两件事
  w.document.getElementById('input').value = T_NAME + '这两次比怎么样？';
  await w.eval('send()');
  await new Promise(r => setTimeout(r, 150));
  const prompt = sentBody ? sentBody.messages.map(m => m.content).join('\n') : '';
  check('提问时把多次考试一起发了过去', prompt.includes('多次考试对比') && prompt.includes('10月月考'),
    prompt.includes('多次考试对比') ? '' : '（没带上）');
  // 默认开启"发给 AI 前替换姓名"，所以这里应该是代号
  check('提问里点名了学生，且姓名已脱敏为代号', prompt.includes(T_CODE), 
    prompt.includes(T_NAME) ? '（真名漏出去了！）' : '（没找到学生代号）');
  check('脱敏后没有真名', !prompt.includes(T_NAME));

  // ── ④ 取消勾选 ──
  console.log('\n===== ④ 取消勾选某次考试 =====');
  const olderId = w.eval('state.exams[0].id');
  w.eval(`setExamSelected(${JSON.stringify(olderId)}, false)`);
  await new Promise(r => setTimeout(r, 80));
  check('只勾一次时上下文不再有多考试段', w.eval(`multiExamContext('同学01')`) === '');
  check('分差标签随之消失', w.document.querySelectorAll('#stuList .delta').length === 0);
  check('对比区随之隐藏', w.document.getElementById('examCompare').style.display === 'none');
  w.eval(`setExamSelected(${JSON.stringify(olderId)}, true)`);
  await new Promise(r => setTimeout(r, 80));
  check('重新勾上后对比又出现', txt('#examCompare').includes('多次考试对比'));

  // ── ⑤ 切换主考试 ──
  console.log('\n===== ⑤ 切换主考试 =====');
  w.eval(`setPrimaryExam(${JSON.stringify(olderId)})`);
  await new Promise(r => setTimeout(r, 80));
  check('DATA 换成了那次考试', w.eval('DATA.考试.名称').includes('09月考'), String(w.eval('DATA.考试.名称')));
  check('右栏跟着换', txt('#examMeta').includes('2026-09-20'));
  check('考试列表标出了新的主考试',
    w.eval(`document.querySelector('#examList .exam-row.primary .exam-name').textContent`).includes('09月考'),
    w.eval(`document.querySelector('#examList .exam-row.primary .exam-name').textContent`));
  // 主考试不是最新那次时，不显示分差（没有"上一次"可比）
  check('主考试不是最新时不显示分差', w.document.querySelectorAll('#stuList .delta').length === 0);

  // ── ⑥ 补充数据 ──
  console.log('\n===== ⑥ 往已有考试里补充数据 =====');
  const target = w.eval('state.exams[0].id');
  const partial = clone(REF);
  partial.学生 = [clone(REF.学生[0])];                    // 只补一个已存在的学生（更正分数）
  partial.学生[0].各科.数学 = 150;
  partial.学生[0].总分 = 0;
  const before = w.eval('state.exams[0].data.学生.length');
  w.eval(`supplementExam(${JSON.stringify(target)}, ${JSON.stringify(partial)})`);
  await new Promise(r => setTimeout(r, 80));
  check('补充不会增加人数', w.eval('state.exams[0].data.学生.length') === before,
    before + ' -> ' + w.eval('state.exams[0].data.学生.length'));
  const fixed = w.eval(`state.exams[0].data.学生.find(s => s.姓名 === ${JSON.stringify(REF.学生[0].姓名)}).各科.数学`);
  check('补充进来的分数生效', fixed === 150, String(fixed));

  const withNew = clone(REF);
  withNew.学生 = [{ 考号: '9999999999', 姓名: '新同学', 选科: '物化地', 总分: 0,
    各科: { 语文: 90, 数学: 90, 英语: 90, 物理: 60, 化学: 60, 地理: 60 } }];
  w.eval(`supplementExam(${JSON.stringify(target)}, ${JSON.stringify(withNew)})`);
  await new Promise(r => setTimeout(r, 80));
  check('补充新学生会追加进来', w.eval('state.exams[0].data.学生.length') === before + 1,
    String(w.eval('state.exams[0].data.学生.length')));
  check('新学生排到对应名次', w.eval(`!!state.exams[0].data.学生.find(s => s.姓名 === '新同学')`));

  // ── ⑦ 删除考试 ──
  console.log('\n===== ⑦ 删除一次考试 =====');
  w.eval(`deleteExam(${JSON.stringify(target)})`);
  await new Promise(r => setTimeout(r, 80));
  check('考试只剩一次', w.eval('state.exams.length') === 1, String(w.eval('state.exams.length')));
  check('剩下的那次成为主考试', w.eval('DATA.考试.名称') === '10月月考', String(w.eval('DATA.考试.名称')));
  check('界面仍有数据', w.eval('DATA.学生.length') === 40);

  // ── ⑧ 持久化与备份 ──
  console.log('\n===== ⑧ 持久化与备份 =====');
  const raw = w.localStorage.getItem(LS_EXAMS_KEY);
  check('按考试存到了本机', !!raw && JSON.parse(raw).exams.length === 1);
  const bk = JSON.parse(w.eval('buildBackup(false)'));
  check('备份包含考试集合', Array.isArray(bk.exams) && bk.exams.length === 1);
  check('备份包含勾选关系', Array.isArray(bk.selectedExamIds) && Array.isArray(bk.primaryExamId ? [1] : []));
  w.eval(`state.exams = []; state.selectedExamIds = []; state.primaryExamId = null; DATA = WuyueParse.empty(); renderAll();`);
  const rr = w.eval(`applyBackup(${JSON.stringify(JSON.stringify(bk))})`);
  check('从备份恢复成功', rr.ok === true, JSON.stringify(rr));
  check('恢复后考试回来了', w.eval('state.exams.length') === 1);
  check('恢复后界面有数据', w.eval('DATA.学生.length') === 40);

  // ── ⑨ 旧数据迁移 ──
  console.log('\n===== ⑨ 老版本数据自动迁移 =====');
  {
    const oldPayload = { data: clone(REF), imported: '3 个文件', source: '旧的.xlsx', at: Date.now() };
    const inj = `<script>try{localStorage.setItem(${JSON.stringify(LS_DATA_KEY)}, ${JSON.stringify(JSON.stringify(oldPayload))});}catch(e){}</script>`;
    const { w: w3, errors: e3 } = load(inj);
    await new Promise(r => setTimeout(r, 250));
    check('迁移后没有报错', e3.length === 0, e3.slice(0, 2).join(' | '));
    check('旧数据被转成一次考试', w3.eval('state.exams.length') === 1);
    check('迁移后界面正常显示', (w3.document.getElementById('stuList').textContent || '').includes('同学01'));
    check('迁移后写了新键', !!w3.localStorage.getItem(LS_EXAMS_KEY));
    check('迁移后清掉了旧键', !w3.localStorage.getItem(LS_DATA_KEY));
  }

  console.log('');
  if (fails.length) {
    console.log(`!! 失败项 ${fails.length} 个：`);
    fails.forEach(f => console.log('   -', f));
    process.exit(1);
  }
  console.log('===== 多考试测试通过 =====');
})().catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
