/* 端到端测试：组卷台（第三个台面）
 *
 * 跑法（项目根目录）： node data/test_assemble_e2e.js
 *
 * 用 jsdom 真跑页面，不是读代码猜：
 *   ① 切台面：中间栏 / 右栏 / 左栏三块该藏的都藏了，标题文案跟着换
 *   ② 题池：8 道真题按得分率排、知识点勾选带题数、题型与搜索能筛
 *   ③ 选题：默认挑最低的 6 道、点卡片能加减、「按掌握率挑满」
 *   ④ 小结与纸面：题数/总分/分钟/大题数与预览内容一致，答案页开关生效
 *   ⑤ 记忆：状态落盘，重开还在组卷台、还记着选过的题
 *   ⑥ 切回分析台 / 方案台的界面复原
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require(path.join(ROOT, '_devtools', 'node_modules', 'jsdom'));

const LS_KEY = 'dsh-grade-workbench-v6';
const PAGE = path.join(ROOT, '成绩分析工作台-首页.html');

const fails = [];
function check(label, cond, extra) {
  console.log(`${cond ? '[OK]  ' : '[FAIL]'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(label);
}

function load(seed) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = (e && e.message) || '';
    if (/Not implemented/.test(m)) return;      // jsdom 没实现导航/打印，属正常
    errors.push(m);
  });
  let html = fs.readFileSync(PAGE, 'utf8');
  if (seed) {
    const inj = `<script>try{localStorage.setItem(${JSON.stringify(LS_KEY)}, ${JSON.stringify(seed)});}catch(e){}</script>`;
    html = html.replace('<head>', '<head>' + inj);
  }
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1:3080/',
  });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  return { w, errors };
}

(async () => {
  const { w, errors } = load(null);
  await new Promise(r => setTimeout(r, 200));
  const doc = w.document;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.from(doc.querySelectorAll(s));
  const disp = id => { const el = doc.getElementById(id); return el ? el.style.display : '<缺失>'; };
  const pickKinds = () => w.eval('JSON.parse(JSON.stringify(state.asm.picked))');

  check('载入页面没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  // ── ① 切台面 ──
  console.log('\n===== ① 切到组卷台 =====');
  check('默认是分析台', $('#modeName').textContent === '分析台' && disp('asmPane') === 'none');
  doc.querySelector('.mode-item[data-mode="assemble"]').click();
  check('台面名变成「组卷台」', $('#modeName').textContent === '组卷台', '得到: ' + $('#modeName').textContent);
  check('中间栏换成候选题池', disp('asmPane') === '' && disp('chatPane') === 'none' &&
    disp('chatComposer') === 'none' && disp('planToolbar') === 'none' && disp('planPane') === 'none');
  check('右栏换成小卷预览', disp('asmPanel') === '' && disp('analyzePanel') === 'none' && disp('planPanel') === 'none');
  check('左栏考试与学生让位', disp('asmLeft') === '' && disp('examSec') === 'none' && disp('stuLeft') === 'none');
  check('左栏对话控件也藏起来', disp('convBar') === 'none' && disp('convLabel') === 'none');
  check('「对话/方案草稿」切换只在方案台出现', disp('planViewSeg') === 'none');
  check('三栏标题跟着换', $('#centerTitle').textContent === '候选题' && $('#rightTitle').textContent === '小卷预览',
    `${$('#centerTitle').textContent} / ${$('#rightTitle').textContent}`);
  check('右栏说明点明题库未接', /M4/.test($('#rightNote').textContent), $('#rightNote').textContent);

  // ── ② 题池 ──
  console.log('\n===== ② 题池与筛选 =====');
  const kpInputs = $$('#asmKpList input[data-kp]');
  check('知识点 5 条', kpInputs.length === 5, '实际 ' + kpInputs.length);
  check('没有题的知识点被禁用', kpInputs.filter(x => x.disabled).length === 1);
  check('知识点后面带题数', $$('#asmKpList .n').map(x => x.textContent.trim()).join('|') === '4 题|2 题|1 题|1 题|0 题',
    $$('#asmKpList .n').map(x => x.textContent.trim()).join('|'));
  check('题池 8 道', $$('#asmPool .qcard').length === 8, '实际 ' + $$('#asmPool .qcard').length);
  check('按得分率从低到高排', $$('#asmPool .qcard')[0].dataset.no === '单选7');
  check('卡片上有得分率与零分人数', /12\.7%/.test($('#asmPool').textContent) && /零分 35 人/.test($('#asmPool').textContent));

  // 题型筛选
  doc.querySelector('#asmTypeSeg [data-asm-type="非选择"]').click();
  check('只看非选择题剩 3 道', $$('#asmPool .qcard').length === 3, '实际 ' + $$('#asmPool .qcard').length);
  doc.querySelector('#asmTypeSeg [data-asm-type="all"]').click();
  check('切回不限又是 8 道', $$('#asmPool .qcard').length === 8);

  // 搜索
  const search = $('#asmSearch');
  search.value = '勒夏特列';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('搜索能筛到那一道', $$('#asmPool .qcard').length === 1 &&
    $$('#asmPool .qcard')[0].dataset.no === '单选7');
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('清空搜索恢复 8 道', $$('#asmPool .qcard').length === 8);

  // 知识点筛选（每次 renderAsm 都会重画左栏，所以要用最新的节点）
  const kpOf = id => $$('#asmKpList input[data-kp]').find(x => x.dataset.kp === id);
  const kp1 = kpOf('选必1-1.2');
  kp1.checked = false;
  kp1.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('取消一个知识点后题变少', $$('#asmPool .qcard').length === 6, '实际 ' + $$('#asmPool .qcard').length);
  doc.getElementById('asmKpAll').click();          // 全不选
  check('「全不选」池子空并给提示', $$('#asmPool .qcard').length === 0 && /没有符合条件的题/.test($('#asmPool').textContent));
  doc.getElementById('asmKpAll').click();          // 全选
  check('再点一次全选回来 8 道', $$('#asmPool .qcard').length === 8);

  // ── ③ 选题 ──
  console.log('\n===== ③ 选题与小结 =====');
  check('默认挑了 6 道', pickKinds().length === 6, '实际 ' + pickKinds().length);
  check('挑的是得分率最低的 6 道', pickKinds().join(',') === '单选7,单选13,单选14,单选11,17,18',
    pickKinds().join(','));
  check('计数条显示 6/6', /已选/.test($('#asmCount').textContent) && $('#asmCount').textContent.includes('6'));
  const sumTxt = $('#asmSum').textContent;
  check('小结：6 题 / 36 分 / 20 分钟 / 2 道大题',
    /6/.test(sumTxt) && /36/.test(sumTxt) && /20/.test(sumTxt) && /2/.test(sumTxt), sumTxt.replace(/\s+/g, ' '));
  const paperTxt = $('#asmPaper').textContent;
  check('纸面预览有标题与题号', paperTxt.includes('化学反应速率与平衡') && paperTxt.includes('1.') &&
    paperTxt.includes('(3分)'));
  check('纸面预览写着含答案页', paperTxt.includes('含答案页'));

  // 点卡片取消 / 再点上（每点一次题池都重画，所以每次都重新找卡片）
  const cardOf = no => $$('#asmPool .qcard').find(c => c.dataset.no === no);
  cardOf('单选7').click();
  check('点一下取消这道', pickKinds().length === 5 && pickKinds().indexOf('单选7') < 0);
  check('总分跟着减到 33', $('#asmSum').textContent.includes('33'));
  cardOf('单选7').click();
  check('再点一下选回来', pickKinds().length === 6 && pickKinds().indexOf('单选7') >= 0);

  // 挑满 / 清空
  doc.getElementById('asmClear').click();
  check('「清空」后一道不剩', pickKinds().length === 0 && $('#asmPaper').textContent.includes('还没选题'));
  doc.getElementById('asmAuto').click();
  check('「按掌握率挑满」挑回 6 道最低的', pickKinds().length === 6 && pickKinds()[0] === '单选7');

  // 目标 / 分钟
  const tgt = $('#asmTarget');
  tgt.value = '4';
  tgt.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('改目标题数后提示同步', $('#asmCount').textContent.includes('目标 4'));
  tgt.value = '999';
  tgt.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('超出范围的目标被夹到 18', tgt.value === '18' || tgt.value === 18, '得到 ' + tgt.value);
  tgt.value = '6';
  tgt.dispatchEvent(new w.Event('change', { bubbles: true }));

  const mins = $('#asmMinutes');
  mins.value = '30';
  mins.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('改考试时长进小结与纸面', $('#asmSum').textContent.includes('30') && $('#asmPaper').textContent.includes('30 分钟'));

  // 答案开关
  const ans = $('#asmAnswers');
  ans.checked = false;
  ans.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('关掉答案页', $('#asmPaper').textContent.includes('不含答案页'));
  ans.checked = true;
  ans.dispatchEvent(new w.Event('change', { bubbles: true }));

  // 标题可改
  const titleIn = $('#asmTitle');
  titleIn.value = '化学 · 平衡专项练';
  titleIn.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('改卷面标题同步到预览', $('#asmPaper').textContent.includes('化学 · 平衡专项练'));

  // 导出/打印：只提示，不报错
  doc.getElementById('asmExport').click();
  doc.getElementById('asmPrint').click();
  check('导出/打印只弹提示不报错', !!doc.getElementById('asmToast') && errors.length === 0,
    errors.slice(0, 2).join(' | '));

  // ── ④ 落盘与重开 ──
  console.log('\n===== ④ 记忆与复原 =====');
  const saved = JSON.parse(w.localStorage.getItem(LS_KEY));
  check('状态里记着台面与选题', saved.mode === 'assemble' && (saved.asm.picked || []).length === 6,
    `mode=${saved.mode} picked=${(saved.asm.picked || []).length}`);
  check('状态里记着目标与时长', saved.asm.target === 6 && saved.asm.minutes === 30);

  {
    const seedStr = w.localStorage.getItem(LS_KEY);
    const second = load(seedStr);
    await new Promise(r => setTimeout(r, 200));
    const w2 = second.w;
    check('重开后仍在组卷台', w2.document.getElementById('modeName').textContent === '组卷台');
    check('重开后选题还在', w2.eval('state.asm.picked.length') === 6);
    check('重开后时长还在', w2.eval('state.asm.minutes') === 30);
    check('重开没有报错', second.errors.length === 0, second.errors.slice(0, 2).join(' | '));
    second.w.close();
  }

  // 切回分析台
  doc.querySelector('.mode-item[data-mode="analyze"]').click();
  check('切回分析台：对话回来、考试与学生回来',
    disp('chatPane') === '' && disp('examSec') === '' && disp('stuLeft') === '' && disp('asmPane') === 'none');
  check('切回分析台：右栏回到成绩分析', disp('analyzePanel') === '' && disp('asmPanel') === 'none');
  check('切回分析台：标题复原', $('#centerTitle').textContent === '对话分析' && $('#rightTitle').textContent === '成绩分析');

  // 切方案台：默认是「与 AI 讨论方案」（对话区），点「方案草稿」才换成工具条+草稿
  doc.querySelector('.mode-item[data-mode="plan"]').click();
  check('切方案台：先到「与 AI 讨论方案」', disp('chatPane') === '' && disp('planToolbar') === 'none' &&
    disp('planPane') === 'none' && disp('asmPane') === 'none');
  doc.querySelector('#planViewSeg [data-view="plan"]').click();
  check('点「方案草稿」：工具条与草稿出现、对话收起',
    disp('planToolbar') === '' && disp('planPane') === '' && disp('chatPane') === 'none');
  check('切方案台：右栏回到方案与复核', disp('planPanel') === '' && disp('asmPanel') === 'none');

  // 再切回组卷台，保持原样
  doc.querySelector('.mode-item[data-mode="assemble"]').click();
  check('再回组卷台：选题没丢', pickKinds().length === 6 && disp('asmPool') !== 'none');

  console.log(`\n${fails.length ? '[FAIL] 失败 ' + fails.length + ' 项' : '[OK] 全部通过'}`);
  if (fails.length) fails.forEach(f => console.log('  - ' + f));
  w.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
