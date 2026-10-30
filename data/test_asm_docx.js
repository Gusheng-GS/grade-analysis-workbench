// 端到端验证：从页面里"点导出"到生成出真正的 .docx。
// 用法：node data/test_asm_docx.js
// 依赖：jsdom（工作区用 _devtools/node_modules，仓库用自带 node_modules）
// 做的事：打开带数据页 → 调 buildAsmDocx() 拿 spec → 交给 docx_gen.js → 写临时 docx → python-docx 读回校验
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAGE = process.env.ASM_PAGE ||
  path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'wb_asm_page.html');
if (!fs.existsSync(PAGE)) {
  console.log('[跳过] 没有带数据页：' + PAGE + '（先跑 python data\\gen_home_html.py --with-data --out %TEMP%\\asm_page.html）');
  process.exit(0);
}

let jsdomPath = 'jsdom';
try { require('jsdom'); } catch (e) {
  jsdomPath = path.join(__dirname, '..', '_devtools', 'node_modules', 'jsdom');
}
const { JSDOM } = require(jsdomPath);
const gen = require(path.join(__dirname, 'docx_gen.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

const html = fs.readFileSync(PAGE, 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://127.0.0.1:3080/' });
const w = dom.window;

setTimeout(() => {
  const out = path.join(os.tmpdir(), 'asm_e2e.docx');
  let spec = null;
  try {
    w.eval(`
      state.mode = 'assemble';
      state.asm.scope = 'one';
      state.asm.picked = ['单选13', '17'];
      setMode('assemble');
      window.__R = buildAsmDocx();
    `);
    const r = w.__R;
    ok(!!r && !r.error, '构建 spec 没有报错' + (r && r.error ? '：' + r.error : ''));
    spec = r.spec;
    ok(r.count === 1, '单人卷份数 = 1');
    ok(/\.docx$/.test(r.fileName), '文件名是 .docx：' + r.fileName);
    ok(Object.keys(spec.images).length > 0, '图片进了包：' + Object.keys(spec.images).length + ' 张');
    ok(spec.blocks.some(b => b.t === 'name'), '有姓名行');
    ok(spec.blocks.some(b => b.t === 'table'), '题干里的表格做成了真表格');
    ok(spec.answers && spec.answers.length > 1, '答案页有内容');
    const inline = spec.blocks.reduce((n, b) => n + ((b.runs || []).filter(x => x.im && x.w < 200).length), 0);
    ok(inline > 0, '有行内公式（小宽度的图）：' + inline + ' 处');
    const buf = gen.buildDocx(spec);
    fs.writeFileSync(out, buf);
    const size = buf.length;
    ok(size > 50000, '生成的文件不为空：' + (size / 1024).toFixed(0) + ' KB');
    console.log('  输出：' + out);
  } catch (e) {
    fail++;
    console.log('  ✗ 异常：' + e.message);
  }
  console.log('\n' + (fail ? '失败 ' + fail + ' 项' : '全部 ' + pass + ' 项通过'));
  process.exit(fail ? 1 : 0);
}, 900);
