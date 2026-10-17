/* 端到端测试：在 jsdom 里真跑一遍工作台页面，把"导入成绩"整条路走通。
 *
 * 为什么用 jsdom 而不是无头浏览器：
 *   本机沙箱不允许 Chromium 建 named pipe（mojo 检查失败：拒绝访问），
 *   无头 Edge 起不来。jsdom 是纯 JS 的 DOM 实现，不受这个限制，
 *   而且能构造 File 对象 —— 正好把"选文件 → 解析 → 载入 → 重绘"全跑一遍。
 *
 * 跑法（项目根目录）： node data/test_import_e2e.js
 *
 * 覆盖：
 *   ① 空白版页面：不报错，左栏右栏都有明确引导
 *   ② 选入三个真实 xlsx：本机解析成功，预览区给出人数/均分
 *   ③ 点「载入到工作台」：学生名单、均分真的出现在页面上，空状态消失
 *   ④ 成绩按"考试"存进 localStorage（下次打开还在）
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');
const XLSX = require('xlsx');

const SRC = path.join(__dirname, 'fixtures', 'wuyue-export');

const FILES = ['06_各科小题分.xlsx', '06_各科试题分析.xlsx', '06_学生成绩(方向名次).xlsx'];

const LS_DATA_KEY = 'dsh-grade-workbench-v6-data';    // 旧键（已被下面的按考试存储取代）
const LS_EXAMS_KEY = 'dsh-grade-workbench-v6-exams';  // 当前：每次考试各存一份

const fails = [];
function check(label, cond, extra) {
  console.log(`${cond ? '[OK]  ' : '[FAIL]'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(label);
}

const html = fs.readFileSync(path.join(ROOT, '成绩分析工作台-首页.html'), 'utf8');

function load(dom_html) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(dom_html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'http://127.0.0.1:3080/',
  });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  return { dom, w, errors };
}

(async () => {
  // ── ① 空白版页面 ──
  console.log('===== ① 空白版页面 =====');
  const { w, errors } = load(html);
  await new Promise(r => setTimeout(r, 300));

  const txt = s => (w.document.querySelector(s) || {}).textContent || '';
  check('页面加载没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('左栏显示"还没有成绩数据"', txt('#stuList').includes('还没有成绩数据'));
  check('左栏提示点"导入成绩"', txt('#stuList').includes('导入成绩'));
  check('左栏班级名是未导入状态', txt('#clsName').includes('还没有导入'));
  check('右栏显示"尚未导入成绩"', txt('#examMeta').includes('尚未导入成绩'));
  check('右栏各科区有引导文字', txt('#subjectBars').includes('导入成绩后'));
  check('右栏不再显示 0 分指标', w.document.getElementById('metrics').innerHTML.trim() === '');
  check('内置数据是空的', w.eval('DATA.学生.length') === 0);
  check('考试列表初始为空并给提示', txt('#examTip').includes('还没有导入任何考试'));

  // ── ② 选文件 → 本机解析 ──
  console.log('\n===== ② 选入真实 xlsx 并本机解析 =====');
  w.XLSX = XLSX;   // 相当于页面已加载 SheetJS
  const files = FILES.map(name => {
    const buf = fs.readFileSync(path.join(SRC, name));
    return new w.File([new Uint8Array(buf)], name, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });
  await w.handleFiles(files);
  await new Promise(r => setTimeout(r, 200));

  const preview = txt('#previewStat');
  check('文件识别正确', txt('#fileList').includes('各科小题分') && txt('#fileList').includes('学生成绩'));
  check('预览出现（未失败）', !preview.includes('无法解析') && !preview.includes('解析失败'), preview.slice(0, 80).replace(/\s+/g, ' '));
  check('预览给出人数 40', preview.includes('40 人'));
  check('预览给出考试日期', preview.includes('2026-09-20'));
  check('预览给出总分均分 436.3', preview.includes('436.3'));
  check('考试名称已自动填好', w.document.getElementById('importExamName').value.length > 0,
    '值为: ' + w.document.getElementById('importExamName').value);
  check('班级名称已自动填好', w.document.getElementById('importClassName').value.length > 0,
    '值为: ' + w.document.getElementById('importClassName').value);
  check('「载入到工作台」已可点', w.document.getElementById('confirmImport').disabled === false);
  check('出现"新考试 / 补充"的选择', w.document.getElementById('importTargetBox').style.display !== 'none');
  check('还没有考试时不能选"补充"', w.document.getElementById('impAsMerge').disabled === true);

  // ── ③ 载入到工作台 ──
  console.log('\n===== ③ 点「载入到工作台」后界面是否真的刷新 =====');
  const before = w.document.getElementById('stuList').innerHTML;
  w.document.getElementById('importClassName').value = '01 班';
  w.document.getElementById('confirmImport').onclick();
  await new Promise(r => setTimeout(r, 300));

  const stuList = txt('#stuList');
  check('左栏列出学生（出现第 1 名的名字）', stuList.includes('同学01'));
  check('左栏列出全部 40 人', w.document.querySelectorAll('#stuList .stu[data-i]').length === 40);
  check('左栏学生列表确实变了', w.document.getElementById('stuList').innerHTML !== before);
  check('班级名换成导入的', txt('#clsName').includes('01 班'));
  check('左栏显示数据来源', txt('#clsSrc').includes('本机保存'));
  check('右栏考试信息出现', txt('#examMeta').includes('2026-09-20'));
  check('右栏显示总分均分 436.3', w.document.getElementById('metrics').innerHTML.includes('436.3'));
  check('右栏各科均分渲染出来', txt('#subjectBars').includes('语文') && txt('#subjectBars').includes('99'));
  check('右栏最该讲的题渲染出来', txt('#hardItems').includes('得分') || txt('#hardItems').includes('%'));
  check('空状态提示消失', !stuList.includes('还没有成绩数据'));
  check('方案台学生下拉已填充', w.document.getElementById('planStudent').options.length === 40);
  check('左栏考试列表出现这一次考试', txt('#examList').length > 0,
    txt('#examList').replace(/\s+/g, ' ').slice(0, 60));
  check('这次考试默认勾选参与分析', w.eval('state.selectedExamIds.length') === 1);
  check('考试列表里标出了主考试', w.document.querySelectorAll('#examList .exam-row.primary').length === 1);

  // ── ④ 持久化 ──
  console.log('\n===== ④ 成绩是否按考试存到本机（刷新后还在）=====');
  const saved = w.localStorage.getItem(LS_EXAMS_KEY);
  check('localStorage 里有导入的考试数据', !!saved);
  let savedOk = false;
  try {
    const o = JSON.parse(saved);
    savedOk = !!(o && o.exams && o.exams.length === 1 && o.exams[0].data.学生.length === 40);
  } catch (e) {}
  check('存的内容是 40 名学生（按考试分别存）', savedOk);
  check('不再往旧的单份数据键里写', !w.localStorage.getItem(LS_DATA_KEY));

  // 模拟"关掉重开"：新建一个页面，把上次存的东西先塞进 localStorage
  const inject = `<script>try{localStorage.setItem(${JSON.stringify(LS_EXAMS_KEY)}, ${JSON.stringify(JSON.stringify(JSON.parse(saved)))});}catch(e){}</script>`;
  const { w: w2, errors: e2 } = load(html.replace('<head>', '<head>' + inject));
  await new Promise(r => setTimeout(r, 300));
  check('重开后没有 JS 报错', e2.length === 0, e2.slice(0, 2).join(' | '));
  check('重开后自动恢复上次成绩', (w2.document.getElementById('stuList').textContent || '').includes('同学01'));
  check('重开后考试列表也恢复', w2.eval('state.exams.length') === 1);

  console.log('');
  if (fails.length) {
    console.log(`!! 失败项 ${fails.length} 个：`);
    fails.forEach(f => console.log('   -', f));
    process.exit(1);
  }
  console.log('===== 端到端测试通过：导入成绩整条路走通 =====');
})().catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
