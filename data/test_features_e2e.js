/* 端到端测试：隐私设置 / 方案导出 / 备份恢复
 *
 * 跑法（项目根目录）： node data/test_features_e2e.js
 *
 * 用 jsdom 真跑页面，不是读代码猜：
 *   ① 脱敏：发给 AI 的请求体里没有真名、只有代号；回来的内容自动还原真名
 *   ② 关掉「保存对话记录」后，对话不落盘、重开也不恢复
 *   ③ 导出：Word 下载 / PDF 打印两条路、范围与内容选项、隐藏姓名都生效
 *   ④ 备份导出与恢复能来回跑通
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');

const LS_KEY = 'dsh-grade-workbench-v6';
const LS_DATA_KEY = 'dsh-grade-workbench-v6-data';
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'home_data.json'), 'utf8'));
// 取一个学生做样本：脱敏后的代号是「学生 + 班名次」，不是固定值
const TARGET = fixture.学生[0];
const T_NAME = TARGET.姓名;
const T_CODE = '学生' + String(TARGET.班名次).padStart(2, '0');

const fails = [];
function check(label, cond, extra) {
  console.log(`${cond ? '[OK]  ' : '[FAIL]'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails.push(label);
}

function load() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = (e && e.message) || '';
    if (/Not implemented/.test(m)) return;      // jsdom 没实现导航/打印，属正常
    errors.push(m);
  });
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, '成绩分析工作台-首页.html'), 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1:3080/',
  });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  w.eval(`applyImportedData(${JSON.stringify(fixture)}, ['06_各科小题分.xlsx','06_学生成绩(方向名次).xlsx'])`);
  return { w, errors };
}

(async () => {
  const { w, errors } = load();
  await new Promise(r => setTimeout(r, 200));
  check('载入测试数据没有报错', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('测试数据是 40 人', w.eval('DATA.学生.length') === 40);

  // ── ① 脱敏 ──
  console.log('\n===== ① 隐私：发给 AI 之前替换姓名 =====');
  let sent = null;
  w.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: T_CODE + ' 这次数学不错，可以再抓物理。' } }] }) };
  };
  w.eval('state.settings.maskBeforeAI = true');
  const res1 = await w.eval(`callAI([{role:'user', content:${JSON.stringify(T_NAME)} + '这次怎么样？\\n学生：' + ${JSON.stringify(T_NAME)}}], 'sk-test')`);
  const body1 = JSON.stringify(sent);
  check('请求体里没有真实姓名', !body1.includes(T_NAME));
  check('请求体里换成了代号', body1.includes(T_CODE));
  check('老师问句里的真名也被换掉了', !body1.includes(T_NAME));
  check('返回内容在本地还原成真名', res1.ok && res1.text.includes(T_NAME) && !res1.text.includes(T_CODE),
    '得到: ' + res1.text);

  w.eval('state.settings.maskBeforeAI = false');
  await w.eval(`callAI([{role:'user', content:${JSON.stringify(T_NAME)} + '这次怎么样？'}], 'sk-test')`);
  check('关掉开关后请求体里是真名', JSON.stringify(sent).includes(T_NAME));

  // 界面自己就打码时，不需要还原
  w.eval('state.settings.maskBeforeAI = true; state.settings.maskNames = true');
  const res2 = await w.eval(`callAI([{role:'user', content:${JSON.stringify(T_NAME)}}], 'sk-test')`);
  check('界面已打码时保持代号不回填', res2.text.includes(T_CODE), '得到: ' + res2.text);
  w.eval('state.settings.maskNames = false');

  // ── ② 保存对话记录 ──
  console.log('\n===== ② 隐私：在本机保存对话记录 =====');
  w.eval(`state.settings.saveHistory = true;
          state.conversations.analyze[0].messages.push({role:'user', html:'测试消息'});
          save();`);
  let saved = JSON.parse(w.localStorage.getItem(LS_KEY));
  check('开着时对话会落盘', ((saved.conversations.analyze[0] || {}).messages || []).length > 0);

  w.eval(`state.settings.saveHistory = false; save();`);
  saved = JSON.parse(w.localStorage.getItem(LS_KEY));
  const convCount = (saved.conversations.analyze || []).length + (saved.conversations.plan || []).length;
  check('关掉后对话不落盘', convCount === 0, '实际还有 ' + convCount + ' 个对话');
  check('关掉后设置本身仍然保存', saved.settings.saveHistory === false);

  {
    // 模拟"盘上有旧对话、但用户已关掉保存" → 重开不应恢复
    const html = fs.readFileSync(path.join(ROOT, '成绩分析工作台-首页.html'), 'utf8');
    const old = {
      mode: 'analyze', planView: 'chat',
      conversations: { analyze: [{ id: 'c1', name: '旧对话', messages: [{ role: 'user', html: '旧消息' }] }], plan: [] },
      activeId: 'c1', keys: [], plans: [], isDemo: false,
      settings: { saveHistory: false, maskBeforeAI: true },
    };
    const inj = `<script>try{localStorage.setItem(${JSON.stringify(LS_KEY)}, ${JSON.stringify(JSON.stringify(old))});}catch(e){}</script>`;
    const vc2 = new VirtualConsole();
    const dom2 = new JSDOM(html.replace('<head>', '<head>' + inj), {
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc2, url: 'http://127.0.0.1:3080/',
    });
    await new Promise(r => setTimeout(r, 200));
    const w2 = dom2.window;
    const msgs = w2.eval('JSON.stringify(state.conversations.analyze.map(c=>c.messages.length))');
    check('重开时不恢复旧对话', !msgs.includes('"1"') || w2.eval('state.conversations.analyze[0].name') !== '旧对话',
      '实际: ' + msgs);
  }

  // ── ③ 方案导出 ──
  console.log('\n===== ③ 方案导出 =====');
  const full = w.eval(`buildExportDoc({scope:'class', format:'docx', include:{weak:true,train:true,notes:true}, onePage:true, hideName:false})`);
  check('全班导出 40 份', full.count === 40, '实际 ' + full.count);
  check('导出文档含学生真名', full.html.includes('同学01'));
  check('导出文档含三个小节', full.html.includes('这次考试的情况') && full.html.includes('接下来两周') && full.html.includes('几句话'));
  check('导出文档是完整 HTML', full.html.startsWith('<!doctype html>') && full.html.includes('</html>'));
  check('文件名带班级与日期', /全班学习方案.*01 班.*\d{8}/.test(full.filename), full.filename);
  check('每人一页时会分页', full.html.includes('onepage'));

  const masked = w.eval(`buildExportDoc({scope:'class', format:'docx', include:{weak:true,train:true,notes:true}, onePage:true, hideName:true})`);
  check('勾隐藏姓名后没有真名', !masked.html.includes('同学01'));
  check('勾隐藏姓名后用代号', masked.html.includes('学生01'));

  const weakOnly = w.eval(`buildExportDoc({scope:'class', format:'docx', include:{weak:true,train:false,notes:false}, onePage:false, hideName:false})`);
  check('只勾补弱时保留考试情况', weakOnly.html.includes('一、这次考试的情况'));
  // 用带序号的整句标题判断，避免和开头那段介绍文字里的"接下来两周"撞上
  check('只勾补弱时去掉训练安排', !weakOnly.html.includes('二、接下来两周怎么安排'));
  check('只勾补弱时去掉结尾寄语', !weakOnly.html.includes('三、几句话'));
  check('不勾每人一页时不分页', !weakOnly.html.includes('class="doc onepage"'));
  check('勾了每人一页时才有分页标记', full.html.includes('class="doc onepage"'));

  // 走一遍真实点击：Word 下载
  let dl = null, printed = null;
  w.downloadFile = (n, c, m) => { dl = { name: n, mime: m, len: c.length }; return n; };
  w.printHtml = html => { printed = html; return true; };
  w.document.getElementById('exportScope').value = 'class';
  w.document.getElementById('exportFormat').value = 'docx';
  w.document.getElementById('confirmExport').onclick();
  check('点导出会下载 .doc 文件', dl && dl.name.endsWith('.doc'), dl ? dl.name : '(没有下载)');
  check('下载的 MIME 是 Word', dl && /msword/.test(dl.mime || ''), dl ? dl.mime : '');
  check('导出对话框已关闭', !w.document.getElementById('exportOverlay').classList.contains('show'));

  w.document.getElementById('exportFormat').value = 'pdf';
  w.document.getElementById('confirmExport').onclick();
  check('选 PDF 会打开打印窗口', !!printed && printed.includes('同学01'));

  // 打印被拦时的兜底
  w.printHtml = () => false;
  dl = null;
  w.document.getElementById('confirmExport').onclick();
  check('打印被拦时改为下载 html', dl && dl.name.endsWith('.html'), dl ? dl.name : '(没有下载)');

  // ── ④ 备份与恢复 ──
  console.log('\n===== ④ 备份与恢复 =====');
  w.eval(`state.plans = [{id:'p1', student:'同学01', type:'both', typeLabel:'补弱+训练', html:'<h2>同学01 的学习方案</h2><h3>一、这次考试的情况</h3>', createdAt: Date.now()}];
          applyImportedData(DATA, ['06_各科小题分.xlsx']);
          state.plans = [{id:'p1', student:'同学01', type:'both', typeLabel:'补弱+训练', html:'<h2>同学01 的学习方案</h2><h3>一、这次考试的情况</h3>', createdAt: Date.now()}];
          save();`);
  const bk = w.eval('buildBackup(false)');
  const bkObj = JSON.parse(bk);
  check('备份含成绩数据', bkObj.data && bkObj.data.学生.length === 40);
  check('备份含方案', Array.isArray(bkObj.plans) && bkObj.plans.length === 1);
  check('默认备份不含密钥', !('keys' in bkObj));
  const bk2 = JSON.parse(w.eval('buildBackup(true)'));
  check('勾选后备份含密钥字段', 'keys' in bk2);

  // 清空后再恢复
  w.eval('DATA = WuyueParse.empty(); state.plans = []; renderAll();');
  check('清空后确实没数据了', w.eval('DATA.学生.length') === 0);
  const rr = w.eval(`applyBackup(${JSON.stringify(bk)})`);
  check('恢复成功', rr.ok === true, JSON.stringify(rr));
  check('恢复后学生数正确', w.eval('DATA.学生.length') === 40);
  check('恢复后方案回来了', w.eval('state.plans.length') === 1);
  check('恢复后界面也刷新了', (w.document.getElementById('stuList').textContent || '').includes('同学01'));
  check('恢复后成绩落盘了', !!w.localStorage.getItem('dsh-grade-workbench-v6-exams'));

  const bad = w.eval(`applyBackup('{"app":"other"}')`);
  check('非本工作台的备份会被拒绝', !!bad.error, bad.error || '');

  console.log('');
  if (fails.length) {
    console.log(`!! 失败项 ${fails.length} 个：`);
    fails.forEach(f => console.log('   -', f));
    process.exit(1);
  }
  console.log('===== 三个功能测试全部通过 =====');
})().catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
