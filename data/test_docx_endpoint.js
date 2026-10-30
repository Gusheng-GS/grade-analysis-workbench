// 测代理的 /docx 接口：起一个真实代理，POST 一份 spec，确认拿回来的是 .docx（ZIP）
// 用法：node data/test_docx_endpoint.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const HOME = process.env.WB_HOME || path.join(__dirname, '..', 'DSH成绩分析工作台');
const PORT = Number(process.env.WB_PORT || 3123);
const TOKEN = 'test-token-123';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

if (!fs.existsSync(path.join(HOME, 'update_agent.js'))) {
  console.log('[跳过] 没找到交付目录：' + HOME);
  process.exit(0);
}

const child = spawn(process.execPath, [
  path.join(HOME, 'update_agent.js'),
  '--home', HOME, '--port', String(PORT), '--token', TOKEN, '--app-port', '3080',
], { stdio: 'ignore' });

function post(body, headers) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/docx', method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json', 'content-length': data.length }, headers || {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

const PNG = 'data:image/png;base64,' + fs.readFileSync(
  path.join(HOME, '..', '简易题库', '化学09月考', 'media', 'paper-021-image21.png')).toString('base64');

const spec = {
  blocks: [
    { t: 'name', text: '张三' },
    { t: 'h1', text: '测试卷' },
    { t: 'runs', runs: [{ text: '1．下列说' }, { im: 'k1', w: 90, h: 23, down: 3 }, { text: '法正确的是（3 分）' }] },
    { t: 'table', rows: [[{ text: '实验' }, { text: '温度' }], [{ text: '①' }, { text: '25' }]] },
  ],
  answers: [{ t: 'h1', text: '答案与解析（1 题）' }, { t: 'runs', runs: [{ text: '1．【单选7】答案：' }, { text: 'B', bold: true }] }],
  images: { k1: PNG },
};

async function main() {
  await new Promise((r) => setTimeout(r, 1200));
  const noToken = await post({ spec }).catch((e) => ({ status: 0, error: e.message }));
  ok(noToken.status === 403 || noToken.status === 401, '没带令牌会被拒绝（' + noToken.status + '）');

  const bad = await post({ spec }, { 'x-wb-token': TOKEN, 'origin': 'http://evil.example' });
  ok(bad.status === 403, '别的网页（跨源）调不动（' + bad.status + '）');

  const res = await post({ spec }, { 'x-wb-token': TOKEN, 'origin': 'http://127.0.0.1:3080' });
  ok(res.status === 200, '带令牌返回 200');
  ok(res.body.slice(0, 2).toString() === 'PK', '返回的是 ZIP（docx）本体');
  ok(/attachment/.test(String(res.headers['content-disposition'] || '')), '带下载头：' + String(res.headers['content-disposition'] || '').slice(0, 60));
  const out = path.join(process.env.TEMP || '.', 'endpoint_test.docx');
  fs.writeFileSync(out, res.body);
  ok(res.body.length > 5000, '文件大小 ' + Math.round(res.body.length / 1024) + ' KB');
  console.log('  输出：' + out);
}

main().catch((e) => { fail++; console.log('  ✗ 异常：' + e.message); }).then(() => {
  try { child.kill(); } catch (e) {}
  console.log('\n' + (fail ? '失败 ' + fail + ' 项' : '全部 ' + pass + ' 项通过'));
  process.exit(fail ? 1 : 0);
});
