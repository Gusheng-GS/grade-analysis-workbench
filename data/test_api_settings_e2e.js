/* 端到端测试：设置页的 DeepSeek 设置（验钥 / 模型 / 思考开关与强度）
 *
 * 跑法（项目根目录）： node data/test_api_settings_e2e.js
 *
 * 全程 stub fetch，断言"真正发出去的请求长什么样"，而不是只看界面文字。
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');

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
    if (/Not implemented/.test(m)) return;
    errors.push(m);
  });
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, '成绩分析工作台-首页.html'), 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'http://127.0.0.1:3080/',
  });
  const w = dom.window;
  w.alert = () => {};
  w.confirm = () => true;
  w.prompt = (q, d) => d || '测试密钥';
  return { w, errors };
}

const MODELS = {
  data: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', effort: { supported_levels: ['low', 'high', 'max'] } },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', effort: { supported_levels: ['low', 'high'] } },
  ],
};
const BALANCE = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0.00', topped_up_balance: '12.34' }] };

(async () => {
  const { w, errors } = load();
  await new Promise(r => setTimeout(r, 200));
  check('页面加载无报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  // 塞一把密钥
  w.eval(`state.keys = [{id:'k1', name:'我的密钥', value:'sk-abcdefghijklmnop'}];
          state.settings.defaultKeyId = 'k1';
          save(); renderKeyList(); fillSettings();`);
  check('密钥列表里有测试按钮', !!w.document.querySelector('[data-test="k1"]'));

  // ── 拦截请求 ──
  const calls = [];
  w.fetch = async (url, opts) => {
    const o = opts || {};
    calls.push({ url: String(url), method: o.method || 'GET', auth: (o.headers || {}).Authorization || '', body: o.body ? JSON.parse(o.body) : null });
    if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => MODELS };
    if (String(url).endsWith('/user/balance')) return { ok: true, status: 200, json: async () => BALANCE };
    if (String(url).endsWith('/chat/completions')) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '可以', reasoning_content: '想了一下' } }], usage: { total_tokens: 42 } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  // ── ① 测试密钥 ──
  console.log('\n===== ① 测试 API 密钥 =====');
  w.document.querySelector('[data-test="k1"]').onclick();
  await new Promise(r => setTimeout(r, 100));
  const stat1 = w.document.getElementById('keyStat-k1').textContent || '';
  const modelsCall = calls.find(c => c.url.endsWith('/models'));
  check('确实请求了 /models', !!modelsCall);
  check('带上了 Bearer 密钥', !!modelsCall && modelsCall.auth === 'Bearer sk-abcdefghijklmnop', modelsCall ? modelsCall.auth : '');
  check('界面提示可用', stat1.includes('可用'), stat1.replace(/\s+/g, ' ').slice(0, 80));
  check('显示余额', stat1.includes('12.34'), stat1.replace(/\s+/g, ' ').slice(0, 80));

  // ── ② 拉模型列表 ──
  console.log('\n===== ② 拉取模型列表 =====');
  w.document.getElementById('fetchModelsBtn').onclick();
  await new Promise(r => setTimeout(r, 150));
  const opts = Array.from(w.document.getElementById('setModel').options).map(o => o.value);
  check('模型下拉来自 DeepSeek 返回', opts.includes('deepseek-chat') && opts.includes('deepseek-reasoner'), opts.join(','));
  const shown = w.document.getElementById('modelTestStat').textContent || '';
  check('界面显示可用模型名', shown.includes('DeepSeek Chat'), shown.replace(/\s+/g, ' ').slice(0, 80));
  check('强度档位取自模型的 supported_levels',
    Array.from(w.document.getElementById('setEffort').options).map(o => o.value).join(',') === 'low,high,max',
    Array.from(w.document.getElementById('setEffort').options).map(o => o.value).join(','));

  // ── ③ 思考开着时的请求参数 ──
  console.log('\n===== ③ 思考开启时的请求参数 =====');
  w.document.getElementById('setModel').value = 'deepseek-reasoner';
  w.document.getElementById('setModel').onchange();
  w.document.getElementById('setThinking').checked = true;
  w.document.getElementById('setThinking').onchange();
  w.document.getElementById('setEffort').value = 'high';
  w.document.getElementById('setEffort').onchange();
  check('模型换成 reasoner 后强度档位跟着变',
    Array.from(w.document.getElementById('setEffort').options).map(o => o.value).join(',') === 'low,high',
    Array.from(w.document.getElementById('setEffort').options).map(o => o.value).join(','));
  w.document.getElementById('testModelBtn').onclick();
  await new Promise(r => setTimeout(r, 150));
  let post = calls.filter(c => c.url.endsWith('/chat/completions')).pop();
  check('模型名发出去了', post && post.body.model === 'deepseek-reasoner', post ? post.body.model : '(没发)');
  check('thinking.type = enabled', post && post.body.thinking && post.body.thinking.type === 'enabled');
  check('reasoning_effort = high', post && post.body.reasoning_effort === 'high');
  check('思考模式下不发 temperature', post && !('temperature' in post.body));
  const stat3 = w.document.getElementById('modelTestStat').textContent || '';
  check('界面报可用并说明思考生效', stat3.includes('可用') && stat3.includes('思考内容'), stat3.replace(/\s+/g, ' ').slice(0, 100));

  // ── ④ 关掉思考 ──
  console.log('\n===== ④ 关掉思考 =====');
  w.document.getElementById('setThinking').checked = false;
  w.document.getElementById('setThinking').onchange();
  check('关掉后强度框被禁用', w.document.getElementById('setEffort').disabled === true);
  w.document.getElementById('testModelBtn').onclick();
  await new Promise(r => setTimeout(r, 150));
  post = calls.filter(c => c.url.endsWith('/chat/completions')).pop();
  check('thinking.type = disabled', post && post.body.thinking && post.body.thinking.type === 'disabled');
  check('关掉后不发 reasoning_effort', post && !('reasoning_effort' in post.body));
  check('关掉后才发 temperature', post && post.body.temperature === 0.4);

  // ── ⑤ 保存与持久化 ──
  console.log('\n===== ⑤ 设置保存 =====');
  w.document.getElementById('setModel').value = 'deepseek-chat';
  w.document.getElementById('setModel').onchange();     // 真实用户换模型也会触发这个，强度档位随之刷新
  w.document.getElementById('setThinking').checked = true;
  w.document.getElementById('setThinking').onchange();
  w.document.getElementById('setEffort').value = 'max';
  w.document.getElementById('setEffort').onchange();
  w.document.getElementById('saveSettings').onclick();
  await new Promise(r => setTimeout(r, 50));
  const savedSettings = JSON.parse(w.localStorage.getItem('dsh-grade-workbench-v6')).settings;
  check('模型已保存', savedSettings.model === 'deepseek-chat', savedSettings.model);
  check('思考开关已保存', savedSettings.thinking === true);
  check('强度已保存', savedSettings.effort === 'max', savedSettings.effort);

  // ── ⑥ 无效密钥的提示 ──
  console.log('\n===== ⑥ 密钥无效时的提示 =====');
  w.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Authentication Fails' } }) });
  w.document.querySelector('[data-test="k1"]').onclick();
  await new Promise(r => setTimeout(r, 100));
  const stat6 = w.document.getElementById('keyStat-k1').textContent || '';
  check('提示不可用', stat6.includes('不可用'), stat6.replace(/\s+/g, ' ').slice(0, 80));
  check('说明是 401 密钥问题', stat6.includes('401'), stat6.replace(/\s+/g, ' ').slice(0, 80));

  console.log('');
  if (fails.length) {
    console.log(`!! 失败项 ${fails.length} 个：`);
    fails.forEach(f => console.log('   -', f));
    process.exit(1);
  }
  console.log('===== API 设置测试通过 =====');
})().catch(e => {
  console.error('测试自身出错：', e);
  process.exit(1);
});
