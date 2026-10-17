/* 生成"合成样例数据"：结构与真实五岳导出一致，但内容全部脱敏 + 随机化。
 *
 * 只读真实文件，写出到 <目标>/data/fixtures/wuyue-export/。
 * 处理：
 *   · 学校 → 示例中学；班级 → 01；姓名 → 学生01..；考号 → 假号
 *   · 学生成绩表的各科分数 + 总分随机化（总分=各科之和），名次列清空
 *   · 小题分表的小题得分随机化；试题分析表的统计值随机化
 *   · 保留原样的：表结构、题号命名（含 '45'/'89'/'1314' 这类合并列）、考试名与日期
 *     —— 这些是解析器要处理的"真实脏结构"，必须原样保留才有测试价值
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SRC = null;   // 发布版不携带真实导出路径

const OUT = path.join(__dirname, 'wuyue-export');
const F_OFFICIAL = '06_学生成绩(方向名次).xlsx';
const F_DETAIL = '06_各科小题分.xlsx';
const F_ANALYSIS = '06_各科试题分析.xlsx';

const FAKE_SCHOOL = '示例中学';
const FAKE_CLASS = '01';

// 固定种子，保证每次生成的样例一样（便于复现）
let seed = 20260920;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function bump(scale) { return Math.round((rnd() * 2 - 1) * scale * 10) / 10; }

fs.mkdirSync(OUT, { recursive: true });

// ── ① 先从官方成绩表建立"姓名 → 学生NN"和"考号 → 假号"的映射 ──
const wbOff = XLSX.readFile(path.join(SRC, F_OFFICIAL));
const wsOff = wbOff.Sheets[wbOff.SheetNames[0]];
const rowsOff = XLSX.utils.sheet_to_json(wsOff, { header: 1, raw: true, defval: '', blankrows: true });

const nameMap = {};     // 真名 -> 学生NN
const noMap = {};       // 真考号 -> 假考号
const rankOf = {};      // 学生NN -> 班名次（保持原名次顺序做映射，便于对照）
const header = rowsOff[2] || [];
const subheader = rowsOff[3] || [];

// 找各科"分数"列
const scoreCols = [];
for (let j = 0; j < header.length; j++) {
  const label = String(header[j] || '').trim();
  if (label && String(subheader[j] || '').trim() === '分数') scoreCols.push({ label: label, col: j });
}
const totalCol = scoreCols.find(s => s.label.indexOf('总分') === 0);
const subjectCols = scoreCols.filter(s => s.label.indexOf('总分') !== 0);

let seq = 0;
const studentRows = [];
for (let r = 5; r < rowsOff.length; r++) {
  const row = rowsOff[r];
  const name = String(row[3] || '').trim();
  if (!name) continue;
  seq += 1;
  const fake = '学生' + String(seq).padStart(2, '0');
  nameMap[name] = fake;
  const realNo = String(row[2] || '').trim();
  if (realNo) noMap[realNo] = '22' + String(1000 + seq);
  rankOf[fake] = String(row[7] || seq);   // 原方向班名次，仅供参考
  studentRows.push({ r: r, fake: fake, name: name });
}
console.log('学生数:', seq, ' 科目列:', subjectCols.map(s => s.label).join('/'));

// 替换一行里的 学校/班级/考号/姓名
function maskIdentity(row) {
  if (!row) return row;
  if (row[0] !== undefined) row[0] = FAKE_SCHOOL;
  if (row[1] !== undefined) row[1] = FAKE_CLASS;
  const realNo = String(row[2] || '').trim();
  if (realNo && noMap[realNo]) row[2] = noMap[realNo];
  const name = String(row[3] || '').trim();
  if (name && nameMap[name]) row[3] = nameMap[name];
  return row;
}

// ── ② 学生成绩：分数随机化，总分=各科之和，名次列清空 ──
for (const st of studentRows) {
  const row = rowsOff[st.r];
  maskIdentity(row);
  let sum = 0;
  for (const s of subjectCols) {
    const v = parseFloat(row[s.col]);
    if (!isFinite(v) || String(row[s.col]).trim() === '') continue;
    let nv = Math.min(100, Math.max(0, Math.round((v + bump(6)) * 10) / 10));
    row[s.col] = nv;
    sum = Math.round((sum + nv) * 10) / 10;
  }
  if (totalCol) row[totalCol.col] = sum;
  // 名次列（分数列后面两位是 方向校名次 / 方向班名次）清空，避免出现真实排名
  for (const s of scoreCols) {
    row[s.col + 1] = '';
    row[s.col + 2] = '';
  }
}
{ // 表头行里的学校/班级字样也替换
  for (const r of [0, 2, 3]) {
    const row = rowsOff[r];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      if (typeof row[j] === 'string') row[j] = row[j].split('示例中学').join(FAKE_SCHOOL);
    }
  }
  const title = rowsOff[0];
  if (title && typeof title[0] === 'string') {
    // 保留考试名（如"高二09月考"），只把学校名换掉
    title[0] = title[0].split('示例中学').join(FAKE_SCHOOL);
  }
}
XLSX.utils.sheet_add_aoa(wsOff, rowsOff, { origin: 'A1' });
XLSX.writeFile(wbOff, path.join(OUT, F_OFFICIAL), { compression: true });
console.log('已写:', F_OFFICIAL);

// ── ③ 各科小题分：身份脱敏 + 小题得分随机化 ──
const wbDet = XLSX.readFile(path.join(SRC, F_DETAIL));
for (const sheetName of wbDet.SheetNames) {
  const ws = wbDet.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !String(row[3] || '').trim()) continue;
    maskIdentity(row);
    // 第 5 列起是题号得分（'总分/班名次/校名次/客观题/主观题' 也算在这里，一并随机化）
    for (let j = 5; j < row.length; j++) {
      const v = parseFloat(row[j]);
      if (!isFinite(v) || String(row[j]).trim() === '') continue;
      row[j] = String(Math.max(0, Math.round((v + bump(1.5)) * 10) / 10).toFixed(2));
    }
  }
  // 表头行里的学校名字样
  for (const r of [0]) {
    const row = rows[r];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      if (typeof row[j] === 'string') row[j] = row[j].split('示例中学').join(FAKE_SCHOOL);
    }
  }
  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' });
}
XLSX.writeFile(wbDet, path.join(OUT, F_DETAIL), { compression: true });
console.log('已写:', F_DETAIL, '工作表:', wbDet.SheetNames.join('/'));

// ── ④ 各科试题分析：统计值随机化（题号/答案/错选分布保留，属班级层面信息）──
const wbAna = XLSX.readFile(path.join(SRC, F_ANALYSIS));
for (const sheetName of wbAna.SheetNames) {
  const ws = wbAna.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !String(row[0] || '').trim()) continue;
    // 3最高分 4最低分 5平均分 7得分率 10难度 11区分度
    for (const j of [3, 4, 5, 7, 10, 11]) {
      const v = parseFloat(row[j]);
      if (!isFinite(v) || String(row[j]).trim() === '') continue;
      let nv = v + bump(j === 7 ? 4 : 0.06);           // 得分率百分制，其它是小数
      if (j === 7) nv = Math.min(100, Math.max(0, nv));
      row[j] = String(nv.toFixed(2));
    }
  }
  const row0 = rows[0];
  if (row0) {
    for (let j = 0; j < row0.length; j++) {
      if (typeof row0[j] === 'string') row0[j] = row0[j].split('示例中学').join(FAKE_SCHOOL);
    }
  }
  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' });
}
XLSX.writeFile(wbAna, path.join(OUT, F_ANALYSIS), { compression: true });
console.log('已写:', F_ANALYSIS, '工作表:', wbAna.SheetNames.join('/'));

console.log('\n输出目录:', OUT);
