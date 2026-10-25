/* 端到端测试：组卷台（第三个台面）—— 按人出卷 + 导出
 *
 * 跑法（项目根目录）：
 *   python data\gen_home_html.py --with-data --out build\_asm_page.html
 *   node data/test_assemble_e2e.js
 *
 * 为什么要带数据的那一版：组卷台的核心是"每个人一张不一样的卷子"，
 * 依据是导入成绩时留下的逐题得分（DATA.学生[i].小题）。空白页没有学生，
 * 这一半逻辑根本跑不到，所以这个测试用 build\_asm_page.html（本地真实数据，
 * 不进仓库、不进交付包）。
 *
 * 检查项：
 *   ① 切台面：三栏该藏的藏、标题文案跟着换
 *   ② 题池：8 道真题、知识点勾选带题数、题型/搜索能筛
 *   ③ 全班各一张：40 份、右边能翻、每份按这个人的错题挑
 *   ④ 每人的卷子不一样（这是本功能的意义所在）
 *   ⑤ 只出一个人：池子里显示他 ✓/✗，点卡片手动加减
 *   ⑥ 导出：一人一页、答案合并在最后一页、文件名干净
 *   ⑦ 记忆：状态落盘，重开还在原处
 *   ⑧ 切回分析台 / 方案台的界面复原
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

// jsdom 有两种来路：开发时在 _devtools 里，仓库里跟着 npm install 走
function loadJsdom() {
  const cands = [path.join(ROOT, '_devtools', 'node_modules', 'jsdom'), 'jsdom'];
  for (const c of cands) {
    try { return require(c); } catch (e) {}
  }
  throw new Error('找不到 jsdom：先 python data\\bootstrap.py 或 npm install');
}
const { JSDOM, VirtualConsole } = loadJsdom();

const LS_KEY = 'dsh-grade-workbench-v6';
const PAGE = path.join(ROOT, 'build', '_asm_page.html');

if (!fs.existsSync(PAGE)) {
  console.log('[SKIP] 没有 build\\_asm_page.html。先生成带数据版：');
  console.log('       python data\\gen_home_html.py --with-data --out build\\_asm_page.html');
  process.exit(0);
}

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
    if (/Not implemented/.test(m)) return;      // jsdom 没实现下载/打印，属正常
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
  await new Promise(r => setTimeout(r, 250));
  const doc = w.document;
  const $ = s => doc.querySelector(s);
  const $$ = s => Array.from(doc.querySelectorAll(s));
  const disp = id => { const el = doc.getElementById(id); return el ? el.style.display : '<缺失>'; };
  const pickKinds = () => w.eval('JSON.parse(JSON.stringify(state.asm.picked))');
  const papersOf = () => w.eval('asmPapers().map(function(p){return {name:p.name, list:p.list.map(function(q){return q.no})}})');

  check('载入页面没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  // ── ① 切台面 ──
  console.log('\n===== ① 切到组卷台 =====');
  check('默认是分析台', $('#modeName').textContent === '分析台');
  doc.querySelector('.mode-item[data-mode="assemble"]').click();
  check('台面名变成「组卷台」', $('#modeName').textContent === '组卷台', '得到: ' + $('#modeName').textContent);
  check('中间栏换成候选题池', disp('asmPane') === '' && disp('chatPane') === 'none' &&
    disp('chatComposer') === 'none' && disp('planToolbar') === 'none' && disp('planPane') === 'none');
  check('右栏换成小卷预览', disp('asmPanel') === '' && disp('analyzePanel') === 'none' && disp('planPanel') === 'none');
  check('左栏考试与学生让位、组卷条件出现', disp('asmLeft') === '' && disp('examSec') === 'none' && disp('stuLeft') === 'none');
  check('左栏对话控件也藏起来', disp('convBar') === 'none' && disp('convLabel') === 'none');
  check('三栏标题跟着换', $('#centerTitle').textContent === '候选题' && $('#rightTitle').textContent === '小卷预览',
    `${$('#centerTitle').textContent} / ${$('#rightTitle').textContent}`);
  check('右栏说明点明"按人出卷"', /按人出卷/.test($('#rightNote').textContent), $('#rightNote').textContent);

  // ── ② 题池 ──
  console.log('\n===== ② 题池与筛选 =====');
  const kpInputs = $$('#asmKpList input[data-kp]');
  check('知识点 5 条', kpInputs.length === 5, '实际 ' + kpInputs.length);
  check('没有题的知识点被禁用', kpInputs.filter(x => x.disabled).length === 1);
  check('知识点后面带题数', $$('#asmKpList .n').map(x => x.textContent.trim()).join('|') === '4 题|2 题|1 题|1 题|0 题',
    $$('#asmKpList .n').map(x => x.textContent.trim()).join('|'));
  check('题池 8 道', $$('#asmPool .qcard').length === 8, '实际 ' + $$('#asmPool .qcard').length);
  check('按得分率从低到高排', $$('#asmPool .qcard')[0].dataset.no === '单选7');
  check('卡片显示全班得分率', /12\.7%/.test($('#asmPool').textContent));
  check('全班模式卡片显示"多少人丢分过半"', /人丢分过半/.test($('#asmPool').textContent),
    ($('#asmPool').textContent.match(/\d+ 人丢分过半/) || [''])[0]);

  doc.querySelector('#asmTypeSeg [data-asm-type="非选择"]').click();
  check('只看非选择剩 3 道', $$('#asmPool .qcard').length === 3, '实际 ' + $$('#asmPool .qcard').length);
  doc.querySelector('#asmTypeSeg [data-asm-type="all"]').click();
  check('切回不限又是 8 道', $$('#asmPool .qcard').length === 8);

  const search = $('#asmSearch');
  search.value = '勒夏特列';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('搜索能筛到那一道', $$('#asmPool .qcard').length === 1 && $$('#asmPool .qcard')[0].dataset.no === '单选7');
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('清空搜索恢复 8 道', $$('#asmPool .qcard').length === 8);

  // ── ③ 全班各一张 ──
  console.log('\n===== ③ 全班各一张 =====');
  check('默认是「全班各一张」', w.eval('state.asm.scope') === 'class');
  check('出卷对象两档都在', $$('#asmScopeSeg .seg-btn').length === 2 &&
    /全班各一张/.test($('#asmScopeSeg').textContent));
  check('全班模式下学生下拉收起来', disp('asmStu') === 'none');
  const papers = papersOf();
  const firstRank = w.eval('asmStuList()[0].姓名');
  check('算出 40 份卷子', papers.length === 40, '实际 ' + papers.length);
  check('每份 6 道题（默认目标）', papers.every(p => p.list.length === 6),
    '分布: ' + Array.from(new Set(papers.map(p => p.list.length))).join(','));
  check('第一份是班第 1 名', papers[0].name === firstRank, papers[0].name);
  check('换人条出现并写"第 1 / 40 份"', disp('asmNav') !== 'none' && /第 1 \/ 40 份/.test($('#asmNav').textContent),
    $('#asmNav').textContent.replace(/\s+/g, ' '));
  check('小结带"份"数', /40<\/b>份/.test($('#asmSum').innerHTML) || /40\s*份/.test($('#asmSum').textContent),
    $('#asmSum').textContent.replace(/\s+/g, ' '));
  check('纸面预览写着这个人的名字', $('#asmPaper').textContent.includes(papers[0].name));
  check('纸面预览有题号与分值', /1\./.test($('#asmPaper').textContent) && /（3 分）/.test($('#asmPaper').textContent));

  // ── ④ 每人的卷子不一样 ──
  console.log('\n===== ④ 每人的卷子不一样 =====');
  const sigs = papers.map(p => p.list.slice().sort().join(','));
  check('40 份里至少出现两种不同题目组合', new Set(sigs).size > 1, '不同组合 ' + new Set(sigs).size + ' 种');
  // 找一对具体的学生：一个做对单选7的，一个单选7零分的
  const pair = w.eval(`(function(){
    var ok = null, bad = null;
    asmStuList().forEach(function(s){
      var m = (s.小题 && s.小题['化学']) || {};
      if (ok === null && m['单选7'] >= 3) ok = s.姓名;
      if (bad === null && m['单选7'] === 0) bad = s.姓名;
    });
    return {ok: ok, bad: bad};
  })()`);
  check('找到"单选7做对的人"和"零分的人"', !!pair.ok && !!pair.bad, JSON.stringify(pair));
  if (pair.ok && pair.bad) {
    const okPick = w.eval(`asmPapers().filter(function(p){return p.name === ${JSON.stringify(pair.ok)}})[0]
      .list.map(function(q){return q.no})`);
    const badPick = w.eval(`asmPapers().filter(function(p){return p.name === ${JSON.stringify(pair.bad)}})[0]
      .list.map(function(q){return q.no})`);
    check('单选7 对丢分的人优先（在卷子里）', badPick.indexOf('单选7') >= 0, badPick.join(','));
    check('两人的卷子不是同一张', okPick.join(',') !== badPick.join(','),
      `${pair.ok}: ${okPick.join(',')}｜${pair.bad}: ${badPick.join(',')}`);
  }

  // 换到第 2 份
  doc.querySelector('#asmNav [data-asm-page="1"]').click();
  check('点 › 换到第 2 份', /第 2 \/ 40 份/.test($('#asmNav').textContent));
  check('换人后纸面名字变了', $('#asmPaper').textContent.includes(papers[1].name));
  check('第一份的 ‹ 可点、最后一份的 › 禁用时可再点回来',
    !doc.querySelector('#asmNav [data-asm-page="-1"]').disabled);
  doc.querySelector('#asmNav [data-asm-page="-1"]').click();
  check('点 ‹ 回到第 1 份', /第 1 \/ 40 份/.test($('#asmNav').textContent));

  // ── ⑤ 只出一个人 ──
  console.log('\n===== ⑤ 只出一个人 =====');
  const names = w.eval('asmStuList().map(function(s){return s.姓名})');
  const target = names[names.length - 1];   // 最后一名：错题最多，最好验证
  w.eval(`(function(){ state.asm.scope='one'; state.asm.stu=${JSON.stringify(target)};
    state.asm.view=0; renderAsm(); })()`);
  check('切单人后学生下拉出现', disp('asmStu') !== 'none');
  check('下拉框选中这个人', $('#asmStu').value === target, '得到 ' + $('#asmStu').value);
  check('换人条收起来', disp('asmNav') === 'none');
  const badges = $$('#asmPool .qcard .who').map(x => x.className + ':' + x.textContent);
  check('题池出现 ✓ 或 ✗ 标记', badges.some(b => /ok/.test(b)) && badges.some(b => /bad/.test(b)),
    badges.join(' | '));
  check('✗ 写着丢了几个分', badges.some(b => /丢了 \d/.test(b)),
    (badges.join(' | ').match(/丢了[\d.]+ 分/g) || [''])[0]);
  check('纸面写着这个人的名字', $('#asmPaper').textContent.includes(target));

  const before = pickKinds().length;
  const cardNo = $('#asmPool .qcard').dataset.no;
  $$('#asmPool .qcard').find(c => c.dataset.no === cardNo).click();
  check('单人模式点卡片能加减', pickKinds().length === before - 1 || pickKinds().length === before + 1,
    `${before} → ${pickKinds().length}`);
  $$('#asmPool .qcard').find(c => c.dataset.no === cardNo).click();
  check('再点一下还原', pickKinds().length === before);

  doc.getElementById('asmClear').click();
  check('「清空」后一道不剩', pickKinds().length === 0 && $('#asmPaper').textContent.includes('还没选题'));
  doc.getElementById('asmAuto').click();
  check('「按掌握率挑满」按这个人挑回 6 道', pickKinds().length === 6, '实际 ' + pickKinds().length);

  const tgt = $('#asmTarget');
  tgt.value = '999';
  tgt.dispatchEvent(new w.Event('change', { bubbles: true }));
  check('超出范围的目标被夹到 18', tgt.value === '18' || tgt.value === 18, '得到 ' + tgt.value);
  tgt.value = '6';
  tgt.dispatchEvent(new w.Event('change', { bubbles: true }));

  // 全班模式点卡片只提示
  w.eval(`(function(){ state.asm.scope='class'; renderAsm(); })()`);
  $$('#asmPool .qcard')[0].click();
  check('全班模式点卡片不瞎改选题', pickKinds().length === 6);

  // ── ⑥ 导出 ──
  console.log('\n===== ⑥ 导出 =====');
  const docClass = w.eval('buildAsmDoc()');
  check('导出没有报错', !docClass.error, docClass.error);
  check('文件名是 ASCII 安全的 .doc', /\.doc$/.test(docClass.fileName) && !/[\\/:*?"<>|]/.test(docClass.fileName),
    docClass.fileName);
  check('导出 40 份', docClass.count === 40, '实际 ' + docClass.count);
  check('是完整 html（Word 能打开）', /^<!doctype html>/.test(docClass.html) && /<\/html>\s*$/.test(docClass.html));
  check('一人一页：每份之间分页', (docClass.html.match(/class="pp"/g) || []).length >= 41,
    'pp 块 ' + (docClass.html.match(/class="pp"/g) || []).length);
  check('答案只合并在一页', (docClass.html.match(/答案与解析/g) || []).length === 1,
    '答案块 ' + (docClass.html.match(/答案与解析/g) || []).length);
  check('答案页列出题号', /【单选7】/.test(docClass.html));
  check('导出内容带学生姓名', docClass.html.includes(papers[0].name));

  // 小卷里不能只有题干（以前就是这个 bug：导出的是"壳子"）
  const hasBank = (w.eval('(window.__ASM_BANK__ || []).length') || 0) > 0;
  check('导出的题带分值', /class="m"[^>]*>（\d+ 分）/.test(docClass.html));
  if (hasBank) {
    check('导出的选择题带 ABCD 选项', /class="pp-o"[^>]*>[ABCD]．/.test(docClass.html));
    check('导出的题干/选项带原图', /class="qi/.test(docClass.html));
    check('句中的公式排成行内图', /class="qi qi-in"/.test(docClass.html));
    check('宽图另起一行', /class="qi" src=/.test(docClass.html));
  } else {
    console.log('    （没有题库正文 data/asm_bank.js，跳过选项/图片相关检查）');
  }

  w.eval(`(function(){ state.asm.scope='one'; state.asm.stu=${JSON.stringify(target)};
    state.asm.picked=['单选7','单选13']; renderAsm(); })()`);
  const docOne = w.eval('buildAsmDoc()');
  check('单人导出只有 1 份', docOne.count === 1 && /1 份|单/.test('1 份'), '实际 ' + docOne.count);
  check('单人文件名带姓名', docOne.fileName.includes(target), docOne.fileName);
  check('单人导出只含选的 2 道题', (docOne.html.match(/class="pp-q"/g) || []).length === 2,
    '题数 ' + (docOne.html.match(/class="pp-q"/g) || []).length);

  const ans = $('#asmAnswers');
  ans.checked = false;
  ans.dispatchEvent(new w.Event('change', { bubbles: true }));
  const docNoAns = w.eval('buildAsmDoc()');
  check('关掉答案页后导出不含答案', !/答案与解析/.test(docNoAns.html));
  ans.checked = true;
  ans.dispatchEvent(new w.Event('change', { bubbles: true }));

  doc.getElementById('asmExport').click();
  doc.getElementById('asmPrint').click();
  check('点导出/打印不报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  // ── ⑦ 落盘与重开 ──
  console.log('\n===== ⑦ 记忆与复原 =====');
  const saved = JSON.parse(w.localStorage.getItem(LS_KEY));
  check('状态记着台面与出卷对象', saved.mode === 'assemble' && saved.asm.scope === 'one',
    `mode=${saved.mode} scope=${saved.asm.scope}`);
  check('状态记着选的学生与题', saved.asm.stu === target && (saved.asm.picked || []).length === 2,
    `stu=${saved.asm.stu} picked=${(saved.asm.picked || []).length}`);

  {
    const second = load(w.localStorage.getItem(LS_KEY));
    await new Promise(r => setTimeout(r, 250));
    const w2 = second.w;
    check('重开后仍在组卷台', w2.document.getElementById('modeName').textContent === '组卷台');
    check('重开后还是单人模式、还是那个人', w2.eval('state.asm.scope') === 'one' && w2.eval('state.asm.stu') === target);
    check('重开后选题还在', w2.eval('state.asm.picked.length') === 2);
    check('重开没有报错', second.errors.length === 0, second.errors.slice(0, 2).join(' | '));
    second.w.close();
  }

  // ── ⑧ 切回 ──
  console.log('\n===== ⑧ 切回分析台 / 方案台 =====');
  doc.querySelector('.mode-item[data-mode="analyze"]').click();
  check('切回分析台：对话回来、考试与学生回来',
    disp('chatPane') === '' && disp('examSec') === '' && disp('stuLeft') === '' && disp('asmPane') === 'none');
  check('切回分析台：右栏回到成绩分析', disp('analyzePanel') === '' && disp('asmPanel') === 'none');
  check('切回分析台：标题复原', $('#centerTitle').textContent === '对话分析' && $('#rightTitle').textContent === '成绩分析');

  doc.querySelector('.mode-item[data-mode="plan"]').click();
  doc.querySelector('#planViewSeg [data-view="plan"]').click();
  check('方案台：工具条与草稿出现、组卷台收起',
    disp('planToolbar') === '' && disp('planPane') === '' && disp('asmPane') === 'none' && disp('asmPanel') === 'none');

  doc.querySelector('.mode-item[data-mode="assemble"]').click();
  check('再回组卷台：选题与出卷对象都在', pickKinds().length === 2 && w.eval('state.asm.scope') === 'one');

  console.log(`\n${fails.length ? '[FAIL] 失败 ' + fails.length + ' 项' : '[OK] 全部通过'}`);
  if (fails.length) fails.forEach(f => console.log('  - ' + f));
  w.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
