/* 五岳阅卷系统导出解析 + 统计
 *
 * 这份文件是 data/gen_home_data.py（Python 参考实现）的 JS 移植版，
 * 目标是"同样的输入文件，产出和 Python 版一模一样的 home_data.json"。
 *
 * 为什么写成独立文件：
 *   网页里要用它（老师点「导入成绩」真的把分数读进来），
 *   Node 里也要用它（拿真实文件跟 Python 的输出逐字段比对）。
 *   同一份代码两处跑，测过的就是上线跑的。
 *
 * 用法：
 *   浏览器  WuyueParse.build(XLSX, {detail: wb, analysis: wb, official: wb}, meta)
 *   Node    const XLSX = require('xlsx'); 同上一行
 *
 * 数据来源（五岳"学校报表_成绩分析 / 班级报表 / 06"目录下的三个文件）：
 *   06_各科小题分.xlsx        每个学生每道题的得分（用于拿学生名单 + 识别合并列）
 *   06_各科试题分析.xlsx      每道题的满分/平均分/得分率/其他作答
 *   06_学生成绩(方向名次).xlsx 官方各科分数与总分（选考科目已赋分，必须用这份）
 */
var WuyueParse = (function () {
  'use strict';

  /** 五岳表里这几列不是题目得分，是元信息。 */
  var META_COLS = ['总分', '班名次', '校名次', '客观题', '主观题'];

  /** 已知科目名。用于从表头里把"科目"和"总分(物理)"这类汇总列区分开。 */
  var KNOWN_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

  /* ────────────────────────── 小工具 ────────────────────────── */

  /** 转数字。空值/非数字返回 null（对应 Python 里 float() 抛异常 -> None）。 */
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /**
   * 四舍五入到 1 位小数，行为对齐 Python 的 round(x, 1)。
   *
   * 为什么不能直接用 Math.round(x*10)/10：
   *   Python 的 round 是"银行家舍入"（.5 向偶数靠），而且是对 double 的
   *   精确十进制值做舍入。直接 Math.round 遇到 .5 会一律进位，偶尔差 0.1。
   *   这里用 toFixed(20) 拿到精确十进制展开再判断。
   */
  function pyRound1(x) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    var neg = x < 0;
    var parts = Math.abs(x).toFixed(20).split('.');
    var ip = parts[0];
    var fp = parts[1] || '00000000000000000000';
    var d1 = fp.charAt(0);
    var rest = fp.slice(1);
    var up;
    if (rest.charAt(0) > '5') up = true;
    else if (rest.charAt(0) < '5') up = false;
    // 正好在 .5 上：后面还有非零数字就进位，否则向偶数靠
    else up = /[1-9]/.test(rest.slice(1)) ? true : (Number(d1) % 2 === 1);
    var big = parseInt(ip + d1, 10);
    if (up) big += 1;
    var out = big / 10;
    return neg ? -out : out;
  }

  /** 取一个工作表为二维数组。defval:'' + blankrows:true 保证行号列号和 Python 版一致。 */
  function rowsOf(XLSX, wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: true, defval: '', blankrows: true,
    });
  }

  function cell(r, i) {
    if (!r || i >= r.length) return '';
    var v = r[i];
    return v === null || v === undefined ? '' : String(v).trim();
  }

  /**
   * 按 Python 的方式把数字转成字符串：整数要带 .0。
   * Python 的 f-string 输出 float 时是 repr，5.0 就是 "5.0"；JS 的 String(5) 是 "5"。
   * 待复核那几句话是拼出来的字符串，必须对齐。
   */
  function pyNumStr(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    return Number.isInteger(x) ? x.toFixed(1) : String(x);
  }

  /* ────────────────── ① 各科小题分 ────────────────── */

  /**
   * 识别"合并列"：与细分列重复计分的合计列。
   * 例：题号列里同时有 '45' 和 '4','5' —— '45' 就是 4 题和 5 题的合计，
   * 讲题时要把这种列排除，否则同一道题会被算两次。
   * 规则：列名是纯数字，且能由其它纯数字列名（去掉 -1 这种小题后缀）拼出来。
   */
  function findParentCols(scoreCols) {
    function isParent(name) {
      if (!/^\d+$/.test(name)) return false;
      var nums = [];
      for (var i = 0; i < scoreCols.length; i++) {
        var s = scoreCols[i];
        if (s === name || META_COLS.indexOf(s) >= 0) continue;
        var head = String(s).split('-')[0];
        if (/^\d+$/.test(head)) nums.push(head);
      }
      function dfs(rem, used) {
        if (!rem) return true;
        for (var i = 0; i < nums.length; i++) {
          if (used.indexOf(i) >= 0) continue;
          if (rem.indexOf(nums[i]) === 0 && dfs(rem.slice(nums[i].length), used.concat([i]))) return true;
        }
        return false;
      }
      return dfs(name, []);
    }
    var out = [];
    for (var i = 0; i < scoreCols.length; i++) if (isParent(scoreCols[i])) out.push(scoreCols[i]);
    return out;
  }

  /** 解析"各科小题分"：每个学生每道题的得分。 */
  function parseDetail(XLSX, wb) {
    var out = {};
    var sheets = wb.SheetNames || [];
    for (var k = 0; k < sheets.length; k++) {
      var subj = sheets[k];
      var rows = rowsOf(XLSX, wb, subj);
      if (rows.length < 3) continue;
      // 第 1 行（下标 1）从第 5 列起是题号
      var head = rows[1] || [];
      var itemNames = [];
      for (var j = 5; j < head.length; j++) itemNames.push(cell(head, j));
      var scoreCols = itemNames.filter(function (n) { return META_COLS.indexOf(n) < 0; });
      var parents = findParentCols(scoreCols);
      var students = [];
      for (var r = 2; r < rows.length; r++) {
        var row = rows[r];
        if (cell(row, 3) === '') continue;
        students.push({
          考号: cell(row, 2),
          姓名: cell(row, 3),
          选科: cell(row, 4),
        });
      }
      out[subj] = { items: itemNames, parents: parents, students: students };
    }
    return out;
  }

  /* ────────────────── ② 各科试题分析 ────────────────── */

  /** 解析"各科试题分析"：每道题的满分、平均分、得分率、典型错选。 */
  function parseAnalysis(XLSX, wb) {
    var out = {};
    var sheets = wb.SheetNames || [];
    for (var k = 0; k < sheets.length; k++) {
      var subj = sheets[k];
      var rows = rowsOf(XLSX, wb, subj);
      var items = {};
      // 必须另存一份顺序：JS 对象的数字型键（"14"）会被排到最前面，
      // 而 Python 的 dict 是严格按插入顺序（也就是表格行序）来的。
      // 得分率并列时靠这个顺序决定谁在前，不能丢。
      var itemOrder = [];
      for (var r = 3; r < rows.length; r++) {
        var row = rows[r];
        var qname = cell(row, 0);
        if (!qname) continue;
        items[qname] = {
          满分: num(row && row.length > 3 ? row[3] : ''),      // 表头是"最高分"，Python 版也用它当满分
          平均分: num(row && row.length > 5 ? row[5] : ''),
          得分率: num(row && row.length > 7 ? row[7] : ''),
          难度: num(row && row.length > 10 ? row[10] : ''),
          典型错选: cell(row, 13),
        };
        itemOrder.push(qname);
      }
      out[subj] = { items: items, itemOrder: itemOrder };
    }
    return out;
  }

  /* ──────────────── ③ 学生成绩(方向名次) ──────────────── */

  /** 解析官方成绩表：各科分数与总分。选考科目是赋分后的分，必须用这份而不是自己求和。 */
  function parseOfficial(XLSX, wb) {
    var sheets = wb.SheetNames || [];
    if (!sheets.length) throw new Error('「学生成绩」表里没有工作表');
    var rows = rowsOf(XLSX, wb, sheets[0]);
    var header = rows[2] || [];
    var subheader = rows[3] || [];

    if (cell(header, 2) !== '考号' || cell(header, 3) !== '姓名') {
      throw new Error('「学生成绩」表的结构和预期不一样（第 3 行应该是表头：学校/班级/考号/姓名/选科…）');
    }

    // 科目名 -> "分数"所在列号
    var scoreCols = {};
    var order = [];
    for (var j = 0; j < header.length; j++) {
      var label = cell(header, j);
      if (!label) continue;
      if (cell(subheader, j) !== '分数') continue;
      scoreCols[label] = j;
      order.push(label);
    }
    if (!order.length) throw new Error('「学生成绩」表里找不到任何"分数"列');

    // 标题行里带考试信息：总分(物理)_学生成绩(方向名次)_2026年09月20日高二09月考
    var title = cell(rows[0], 0);
    var titleTail = '';
    var m = /_([^_]+)$/.exec(title);
    if (m) titleTail = m[1];

    var students = {};
    var roster = [];
    for (var r = 5; r < rows.length; r++) {
      var row = rows[r];
      var name = cell(row, 3);
      if (!name) continue;
      var rec = { 考号: cell(row, 2), 选科: cell(row, 4), 学校: cell(row, 0), 班级: cell(row, 1) };
      for (var i = 0; i < order.length; i++) {
        var lb = order[i];
        var jj = scoreCols[lb];
        rec[lb] = jj < (row ? row.length : 0) ? num(row[jj]) : null;
      }
      students[name] = rec;
      roster.push(name);
    }
    return {
      scoreCols: scoreCols, order: order, students: students,
      officialOrder: roster, title: title, examLabel: titleTail,
    };
  }

  /* ────────────────── 考试信息（从文件里推） ────────────────── */

  /**
   * 从表标题推断考试名称与日期。
   * 例："2026年09月20日高二09月考" -> {date:'2026-09-20', name:'高二09月考'}
   * 推不出来就返回空，由老师在导入对话框里填。
   */
  function parseExamLabel(label) {
    var out = { date: '', name: '' };
    if (!label) return out;
    var m = /(\d{4})年(\d{1,2})月(\d{1,2})日(.*)$/.exec(label);
    if (m) {
      var mm = ('0' + m[2]).slice(-2);
      var dd = ('0' + m[3]).slice(-2);
      out.date = m[1] + '-' + mm + '-' + dd;
      out.name = m[4].trim();
    } else {
      out.name = String(label).trim();
    }
    return out;
  }

  /* ────────────────────── 汇总成 DATA ────────────────────── */

  /**
   * 把三个工作簿拼成首页需要的 DATA。
   *
   * @param XLSX    SheetJS（浏览器 window.XLSX / Node require('xlsx')）
   * @param wbs     {detail, analysis, official} 三个工作簿（缺哪个传 null）
   * @param meta    可选覆盖：{examName, examDate, school, className, classTrack}
   * @returns DATA 对象（字段与 home_data.json 完全一致）
   */
  function build(XLSX, wbs, meta) {
    meta = meta || {};
    if (!wbs || !wbs.official) throw new Error('缺少「学生成绩(方向名次)」文件，无法得到各科分数');

    var official = parseOfficial(XLSX, wbs.official);
    var detail = wbs.detail ? parseDetail(XLSX, wbs.detail) : {};
    var analysis = wbs.analysis ? parseAnalysis(XLSX, wbs.analysis) : {};

    // 科目列表：以官方成绩表的"分数"列顺序为准，只保留真的有分数的科目
    var subjAll = official.order.filter(function (lb) {
      return KNOWN_SUBJECTS.indexOf(lb) >= 0;
    });
    var subjects = subjAll.filter(function (subj) {
      for (var n in official.students) {
        if (official.students[n][subj] !== null && official.students[n][subj] !== undefined) return true;
      }
      return false;
    });

    // 学生名单：以「各科小题分」里的顺序为基准（和 Python 版一致，影响同分时的名次先后）
    var baseNames = [];
    var baseDetail = detail['数学'] || detail[Object.keys(detail)[0] || ''] || null;
    if (baseDetail && baseDetail.students.length) {
      baseNames = baseDetail.students.map(function (s) { return s.姓名; });
    } else {
      baseNames = official.officialOrder.slice();
    }

    var roster = [];
    for (var i = 0; i < baseNames.length; i++) {
      var name = baseNames[i];
      var off = official.students[name];
      if (!off) continue;                      // 明细里有、官方表里没有 -> 跳过
      var perSubject = {};
      for (var s2 = 0; s2 < subjects.length; s2++) {
        var subj = subjects[s2];
        var v = off[subj];
        if (v !== null && v !== undefined) perSubject[subj] = pyRound1(v);
      }
      var total = off['总分(物理)'];
      if (total === null || total === undefined) {
        var sum = 0;
        for (var s3 = 0; s3 < subjects.length; s3++) {
          var vv = perSubject[subjects[s3]];
          if (vv !== undefined) sum += vv;
        }
        total = sum;
      }
      roster.push({
        考号: off.考号 || '',
        姓名: name,
        选科: off.选科 || '',
        总分: pyRound1(total),
        各科: perSubject,
      });
    }
    if (!roster.length) throw new Error('没有解析到任何学生，请确认选的是五岳导出的班级成绩文件夹');

    // 按总分排名（同分保持原顺序，和 Python 的稳定排序一致）
    roster.sort(function (a, b) { return b.总分 - a.总分; });
    for (var k = 0; k < roster.length; k++) roster[k].班名次 = k + 1;

    // 全班概况
    var totals = roster.map(function (s) { return s.总分; });
    var sumTotal = 0;
    for (var t = 0; t < totals.length; t++) sumTotal += totals[t];
    var avgTotal = totals.length ? sumTotal / totals.length : 0;

    // 各科统计
    var subjectStats = [];
    for (var a = 0; a < subjects.length; a++) {
      var sj = subjects[a];
      var vals = [];
      for (var b = 0; b < roster.length; b++) {
        var x = roster[b].各科[sj];
        if (x !== undefined && x !== null) vals.push(x);
      }
      if (!vals.length) continue;
      var vs = 0;
      for (var c = 0; c < vals.length; c++) vs += vals[c];
      subjectStats.push({
        科目: sj,
        均分: pyRound1(vs / vals.length),
        最高: pyRound1(Math.max.apply(null, vals)),
        最低: pyRound1(Math.min.apply(null, vals)),
      });
    }

    // 最该讲的题：得分率最低的全班性失分（排除合并列）
    var hardItems = [];
    for (var d = 0; d < subjects.length; d++) {
      var subject = subjects[d];
      var entry = analysis[subject] || {};
      var items = entry.items || {};
      var itemOrder = entry.itemOrder || Object.keys(items);
      var parents = (detail[subject] && detail[subject].parents) || [];
      for (var qi = 0; qi < itemOrder.length; qi++) {
        var qname = itemOrder[qi];
        if (parents.indexOf(qname) >= 0) continue;
        var it = items[qname];
        if (!it || !it.满分 || it.满分 <= 0) continue;
        if (it.得分率 === null || it.得分率 === undefined) continue;
        hardItems.push({
          科目: subject,
          题号: qname,
          满分: it.满分,
          平均分: it.平均分,
          得分率: pyRound1(it.得分率),
          典型错选: String(it.典型错选 || '').slice(0, 60),
        });
      }
    }
    hardItems.sort(function (a, b) { return a.得分率 - b.得分率; });

    // 待复核：得分率最低的 5 道，提醒老师人工看一眼
    var review = [];
    for (var e = 0; e < Math.min(5, hardItems.length); e++) {
      var hi = hardItems[e];
      review.push({
        对象: hi.科目 + ' 第' + hi.题号 + '题',
        原因: '全班得分率仅 ' + pyNumStr(hi.得分率) + '%，平均只拿到 ' +
              pyNumStr(hi.平均分) + '/' + pyNumStr(hi.满分) + ' 分',
        优先级: hi.得分率 < 20 ? '高' : '中',
      });
    }

    // 班级选科：取学生里最常见的那个
    var trackCount = {};
    for (var f = 0; f < roster.length; f++) {
      var tk = roster[f].选科;
      if (tk) trackCount[tk] = (trackCount[tk] || 0) + 1;
    }
    var track = meta.classTrack || '';
    if (!track) {
      var best = 0;
      for (var tk2 in trackCount) if (trackCount[tk2] > best) { best = trackCount[tk2]; track = tk2; }
    }

    var exam = parseExamLabel(meta.examLabel || official.examLabel);
    var first = roster.length ? official.students[roster[0].姓名] : null;
    var school = meta.school || (first ? (first.学校 || '') : '');
    // 班级名：表里只有编号（如 "06"），先给个"06 班"，老师可以在导入对话框里改成"高二06班"
    var clsNo = first ? (first.班级 || '') : '';

    return {
      考试: {
        名称: meta.examName || exam.name || '',
        日期: meta.examDate || exam.date || '',
        学校: school,
      },
      班级: {
        名称: meta.className || (clsNo ? clsNo + ' 班' : ''),
        选科: track,
        人数: roster.length,
        科目: subjects,
      },
      概况: {
        总分均分: pyRound1(avgTotal),
        总分最高: totals.length ? pyRound1(Math.max.apply(null, totals)) : 0,
        总分最低: totals.length ? pyRound1(Math.min.apply(null, totals)) : 0,
      },
      科目统计: subjectStats,
      学生: roster,
      最该讲的题: hardItems.slice(0, 12),
      待复核: review,
    };
  }

  /** 一份"空数据"，用于还没导入任何成绩时，保证界面各处读得到字段。 */
  function empty() {
    return {
      考试: { 名称: '', 日期: '', 学校: '' },
      班级: { 名称: '', 选科: '', 人数: 0, 科目: [] },
      概况: { 总分均分: 0, 总分最高: 0, 总分最低: 0 },
      科目统计: [], 学生: [], 最该讲的题: [], 待复核: [],
    };
  }

  /**
   * 依据 data.学生 重算：班名次、概况、科目统计、待复核。
   *
   * 为什么单独拎出来：导入新考试时用 build()，往已有考试里"补充数据"时要用它 ——
   * 两条路必须算出同一套数字，否则补完数据名次就乱了。
   */
  function recomputeAggregates(data) {
    var students = (data.学生 || []).slice();
    // 按总分排名；同分保持原有顺序（和 build() 里的稳定排序一致）
    students.sort(function (a, b) { return b.总分 - a.总分; });
    for (var i = 0; i < students.length; i++) students[i].班名次 = i + 1;
    data.学生 = students;

    // 科目顺序：优先沿用班级里记着的顺序，再补上学生身上新出现的科目
    var subjects = ((data.班级 && data.班级.科目) || []).slice();
    for (var s = 0; s < students.length; s++) {
      var keys = Object.keys(students[s].各科 || {});
      for (var k = 0; k < keys.length; k++) {
        if (subjects.indexOf(keys[k]) < 0) subjects.push(keys[k]);
      }
    }
    if (data.班级) {
      data.班级.科目 = subjects;
      data.班级.人数 = students.length;
    }

    var totals = [];
    var sum = 0;
    for (var t = 0; t < students.length; t++) { totals.push(students[t].总分); sum += students[t].总分; }
    data.概况 = {
      总分均分: pyRound1(totals.length ? sum / totals.length : 0),
      总分最高: totals.length ? pyRound1(Math.max.apply(null, totals)) : 0,
      总分最低: totals.length ? pyRound1(Math.min.apply(null, totals)) : 0,
    };

    var stats = [];
    for (var a = 0; a < subjects.length; a++) {
      var vals = [];
      for (var b = 0; b < students.length; b++) {
        var v = students[b].各科[subjects[a]];
        if (v !== undefined && v !== null) vals.push(v);
      }
      if (!vals.length) continue;
      var vs = 0;
      for (var c = 0; c < vals.length; c++) vs += vals[c];
      stats.push({
        科目: subjects[a],
        均分: pyRound1(vs / vals.length),
        最高: pyRound1(Math.max.apply(null, vals)),
        最低: pyRound1(Math.min.apply(null, vals)),
      });
    }
    data.科目统计 = stats;

    var hard = data.最该讲的题 || [];
    var review = [];
    for (var e = 0; e < Math.min(5, hard.length); e++) {
      var hi = hard[e];
      review.push({
        对象: hi.科目 + ' 第' + hi.题号 + '题',
        原因: '全班得分率仅 ' + pyNumStr(hi.得分率) + '%，平均只拿到 ' +
              pyNumStr(hi.平均分) + '/' + pyNumStr(hi.满分) + ' 分',
        优先级: hi.得分率 < 20 ? '高' : '中',
      });
    }
    data.待复核 = review;
    return data;
  }

  /* ────────────── 多考试：合并（补充数据） ────────────── */

  /** 学生身份键：优先考号（更可靠），没有考号就用姓名。 */
  function studentKey(s) {
    var no = s && s.考号 ? String(s.考号).trim() : '';
    return no ? ('no:' + no) : ('name:' + ((s && s.姓名) || ''));
  }

  /**
   * 把 incoming 合并进 base，返回新的 data（不改动传入的两个对象）。
   *
   * 用途：同一场考试"补充数据" —— 后来补了几个学生、补了几科、或更正了分数。
   * 规则：
   *   · 学生：按考号（没考号按姓名）配对；配上的合并各科（新数据覆盖同科），
   *           incoming 里多出来的学生直接追加
   *   · 总分：合并后按各科之和重算（五岳的官方总分就是各科之和，实测完全一致）
   *   · 名次/概况/科目统计/待复核：全部重算，保证和"一次性导入"结果一致
   *   · 最该讲的题：两边并集，按科目+题号去重（incoming 优先）
   */
  function mergeExamData(base, incoming) {
    var out = JSON.parse(JSON.stringify(base || empty()));
    var inc = incoming || empty();

    var map = {};
    var order = [];
    for (var i = 0; i < (out.学生 || []).length; i++) {
      var s = out.学生[i];
      map[studentKey(s)] = s;
      order.push(studentKey(s));
    }

    for (var j = 0; j < (inc.学生 || []).length; j++) {
      var ns = inc.学生[j];
      var key = studentKey(ns);
      var hit = map[key];
      if (!hit) {
        // 新学生：整体搬过来（深拷贝，避免两个考试共享对象）
        var copy = JSON.parse(JSON.stringify(ns));
        map[key] = copy;
        order.push(key);
        continue;
      }
      // 老学生：合并各科（incoming 覆盖同科），补齐缺失字段
      hit.各科 = hit.各科 || {};
      var ks = Object.keys(ns.各科 || {});
      for (var k = 0; k < ks.length; k++) hit.各科[ks[k]] = ns.各科[ks[k]];
      if (ns.姓名) hit.姓名 = ns.姓名;
      if (ns.考号) hit.考号 = ns.考号;
      if (ns.选科) hit.选科 = ns.选科;
    }

    var roster = [];
    for (var o = 0; o < order.length; o++) roster.push(map[order[o]]);

    // 总分按各科之和重算（五岳官方总分 = 各科之和，实测逐人一致）
    for (var r = 0; r < roster.length; r++) {
      var subjKeys = Object.keys(roster[r].各科 || {});
      var total = 0;
      for (var q = 0; q < subjKeys.length; q++) total += roster[r].各科[subjKeys[q]];
      roster[r].总分 = pyRound1(total);
    }
    out.学生 = roster;

    // 最该讲的题：并集去重（incoming 优先）
    var seen = {};
    var hard = [];
    function addHard(list) {
      for (var h = 0; h < (list || []).length; h++) {
        var it = list[h];
        var id = it.科目 + '|' + it.题号;
        if (seen[id]) continue;
        seen[id] = 1;
        hard.push(JSON.parse(JSON.stringify(it)));
      }
    }
    addHard(inc.最该讲的题);
    addHard(out.最该讲的题);
    hard.sort(function (a, b) { return a.得分率 - b.得分率; });
    out.最该讲的题 = hard.slice(0, 12);

    // 考试信息：补齐空缺（不覆盖已有值）
    out.考试 = out.考试 || { 名称: '', 日期: '', 学校: '' };
    var incExam = inc.考试 || {};
    if (!out.考试.名称 && incExam.名称) out.考试.名称 = incExam.名称;
    if (!out.考试.日期 && incExam.日期) out.考试.日期 = incExam.日期;
    if (!out.考试.学校 && incExam.学校) out.考试.学校 = incExam.学校;

    return recomputeAggregates(out);
  }

  /** 根据文件名判断是哪一个五岳导出文件。 */
  function classifyFileName(name) {
    var n = String(name || '');
    if (/小题分/.test(n)) return 'detail';
    if (/试题分析/.test(n)) return 'analysis';
    if (/学生成绩/.test(n)) return 'official';
    return '';
  }

  return {
    build: build,
    empty: empty,
    recomputeAggregates: recomputeAggregates,
    mergeExamData: mergeExamData,
    classifyFileName: classifyFileName,
    parseExamLabel: parseExamLabel,
    pyRound1: pyRound1,
    findParentCols: findParentCols,
    META_COLS: META_COLS,
  };
})();

/* Node 里能 require，浏览器里就是全局变量 WuyueParse。 */
if (typeof module !== 'undefined' && module.exports) module.exports = WuyueParse;
