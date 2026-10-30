// -*- coding: utf-8 -*-
/**
 * 最小 docx 生成器（零依赖）
 *
 * 为什么要自己写：交付包里不能假设老师电脑装了 Python，也不想为了导出
 * 塞一个 1MB 的前端库。docx 本质就是一个 zip 包着一堆 XML，自己拼一遍
 * 反而最可控 —— 图片多大、表格几列、在哪里分页，全都写死在文件里，
 * 不再由 Word 打开时"猜"（这就是之前 .doc 出现巨图的根子）。
 *
 * 对外只有 buildDocx(spec) -> Buffer。spec 见文件末尾的说明。
 */
"use strict";

const zlib = require("zlib");

// ───────────────────────── ZIP（store，不压缩） ─────────────────────────
const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zipStore(files) {
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;      // 1980-01-01，固定值：同样输入得同样字节
  const parts = [];
  const central = [];
  let offset = 0;

  files.forEach(function (f) {
    const name = Buffer.from(f.name, "utf8");
    const data = f.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);              // 文件名 UTF-8
    local.writeUInt16LE(0, 8);                   // store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + data.length;
  });

  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat(parts.concat([cenBuf, eocd]));
}

// ───────────────────────── 单位与 XML 小工具 ─────────────────────────
const EMU_PER_PX = 9525;                      // 96 dpi
const px2emu = (px) => Math.round(px * EMU_PER_PX);
const px2twip = (px) => Math.round(px * 15);  // 1px = 0.75pt = 15 twip

// A4=11906x16838 twip；上下边距 1440，左右 1440 → 版心 9026 twip ≈ 602px
const PAGE = { w: 11906, h: 16838, mTop: 1440, mBottom: 1440, mLeft: 1440, mRight: 1440 };
const BODY_W_PX = 600;                        // 版心宽（px），导出时图片不会超过它

const FONT_SONG = "宋体";
const FONT_HEI = "黑体";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rPr(o) {
  const opt = o || {};
  const font = opt.font || FONT_SONG;
  const bits = ['<w:rFonts w:ascii="' + font + '" w:hAnsi="' + font +
    '" w:eastAsia="' + font + '" w:cs="' + font + '"/>'];
  if (opt.bold) bits.push("<w:b/><w:bCs/>");
  if (opt.color) bits.push('<w:color w:val="' + opt.color + '"/>');
  if (opt.size) bits.push('<w:sz w:val="' + Math.round(opt.size * 2) + '"/><w:szCs w:val="' +
    Math.round(opt.size * 2) + '"/>');
  if (opt.down) bits.push('<w:position w:val="-' + Math.round(opt.down * 1.5) + '"/>');
  return "<w:rPr>" + bits.join("") + "</w:rPr>";
}

function runText(text, o) {
  if (text == null || text === "") return "";
  return "<w:r>" + rPr(o) + '<w:t xml:space="preserve">' + esc(text) + "</w:t></w:r>";
}

let _imgSeq = 0;
/** 每张图一个自增编号：Word 要求 wp:docPr 的 id 是正整数，写非数字会直接拒绝打开文档 */
function runImage(rid, wPx, hPx, o) {
  const opt = o || {};
  const cx = px2emu(wPx), cy = px2emu(hPx);
  _imgSeq += 1;
  const num = _imgSeq;
  const name = "图片" + num;
  return "<w:r>" + rPr(opt) +
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + num + '" name="' + esc(name) + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + num + '" name="' + esc(name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
}

function para(content, o) {
  const opt = o || {};
  const pPr = [];
  if (opt.pageBreakBefore) pPr.push("<w:pageBreakBefore/>");
  if (opt.keepNext) pPr.push("<w:keepNext/>");
  const sp = [];
  if (opt.before != null) sp.push('w:before="' + px2twip(opt.before) + '"');
  if (opt.after != null) sp.push('w:after="' + px2twip(opt.after) + '"');
  if (opt.line) sp.push('w:line="' + Math.round(opt.line * 240) + '" w:lineRule="auto"');
  if (sp.length) pPr.push("<w:spacing " + sp.join(" ") + "/>");
  if (opt.firstIndent) pPr.push('<w:ind w:firstLine="' + px2twip(opt.firstIndent) + '"/>');
  if (opt.leftIndent) pPr.push('<w:ind w:left="' + px2twip(opt.leftIndent) + '"/>');
  if (opt.align) pPr.push('<w:jc w:val="' + opt.align + '"/>');
  return "<w:p>" + (pPr.length ? "<w:pPr>" + pPr.join("") + "</w:pPr>" : "") + (content || "") + "</w:p>";
}

/** rows=[[cell…]…]，cell = {text} / {runs:[…]} / {cs:n} */
function table(rows, o) {
  const opt = o || {};
  const nCol = rows.reduce(function (m, r) { return Math.max(m, (r || []).length); }, 1);
  const totalW = px2twip(Math.min(opt.width || BODY_W_PX, BODY_W_PX));
  const colW = Math.max(200, Math.round(totalW / nCol));
  const grid = "<w:tblGrid>" + new Array(nCol).fill('<w:gridCol w:w="' + colW + '"/>').join("") + "</w:tblGrid>";
  const borders = "<w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (k) {
      return "<w:" + k + ' w:val="single" w:sz="4" w:space="0" w:color="808080"/>';
    }).join("") + "</w:tblBorders>";
  const tblPr = "<w:tblPr>" + '<w:tblW w:w="' + totalW + '" w:type="dxa"/>' + borders +
    '<w:tblLayout w:type="fixed"/><w:jc w:val="center"/></w:tblPr>';

  const trs = rows.map(function (row) {
    const tcs = (row || []).map(function (c) {
      const cell = c || {};
      const tcPr = ['<w:tcPr>',
        '<w:tcW w:w="' + (colW * (cell.cs || 1)) + '" w:type="dxa"/>',
        cell.cs > 1 ? '<w:gridSpan w:val="' + cell.cs + '"/>' : "",
        '<w:vAlign w:val="center"/>',
        "</w:tcPr>"].join("");
      let content = "";
      if (cell.runs && cell.runs.length) {
        // 单元格里的内容可能含图片（表头里的化学式就是图），交给调用方传进来的渲染器，
        // 这样和正文用的是同一套 run 逻辑，不会出现"表头一片空白方框"。
        content = (opt.runs ? opt.runs(cell) : runText(cell.text, { size: 10.5 }));
      } else {
        content = runText(cell.text, { size: 10.5 });
      }
      return "<w:tc>" + tcPr + para(content, { align: "center", line: 1.0 }) + "</w:tc>";
    }).join("");
    return "<w:tr>" + tcs + "</w:tr>";
  }).join("");

  return "<w:tbl>" + tblPr + grid + trs + "</w:tbl>";
}

// ───────────────────────── 文档装配 ─────────────────────────
function buildDocx(spec) {
  const S = spec || {};
  const media = {};       // key -> {name, buf}
  const rels = [];        // [rid, target]
  let imgN = 0;

  function resolveImg(key, uri) {
    if (media[key]) return media[key];
    const m = /^data:image\/(\w+);base64,(.*)$/.exec(String(uri || ""));
    if (!m) return null;
    imgN += 1;
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const rec = { name: "media/image" + imgN + "." + ext, rid: "rId" + (100 + imgN), buf: Buffer.from(m[2], "base64") };
    media[key] = rec;
    rels.push([rec.rid, rec.name]);
    return rec;
  }

  function runsXml(runs, o) {
    return (runs || []).map(function (r) {
      if (r.im) {
        const rec = resolveImg(r.im, (S.images || {})[r.im]);
        if (!rec) return runText("〔图〕", o);
        let w = Math.max(4, r.w || 0), h = Math.max(4, r.h || 0);
        if (w > BODY_W_PX) { h = Math.round(h * BODY_W_PX / w); w = BODY_W_PX; }
        return runImage(rec.rid, w, h, { down: r.down || 0 });
      }
      return runText(r.text, { size: (o && o.size) || 11, bold: r.bold, font: r.font, color: r.color });
    }).join("");
  }

  function blocksXml(blocks) {
    return (blocks || []).map(function (b) {
      const t = b && b.t;
      if (t === "h1") return para(runText(b.text, { size: 15, bold: true, font: FONT_HEI }), { align: "center", before: 2, after: 6, line: 1.2, pageBreakBefore: !!b.newPage });
      if (t === "h2") return para(runText(b.text, { size: 12, bold: true, font: FONT_HEI }), { align: "center", after: 4, pageBreakBefore: !!b.newPage });
      if (t === "name") return para(runText(b.text, { size: 12, bold: true, font: FONT_HEI }), { before: 2, after: 2, pageBreakBefore: !!b.newPage });
      if (t === "sub") return para(runText(b.text, { size: 9, color: "666666" }), { after: 6, line: 1.2 });
      if (t === "pagebreak") return para("", { pageBreakBefore: true });
      if (t === "spacer") return para("", { after: (b.h || 8) });
      if (t === "table") return table(b.rows || [], { width: b.width, runs: function (cell) { return runsXml(cell.runs, { size: 10.5 }); } });
      if (t === "runs") return para(runsXml(b.runs, { size: b.size }), { line: b.line || 1.4, firstIndent: b.firstIndent || 0, before: b.before, after: b.after, align: b.align });
      // 默认当普通段落
      return para(runText(b.text, { size: b.size || 11 }), { line: b.line || 1.4, firstIndent: b.firstIndent || 0, before: b.before, after: b.after, align: b.align });
    }).join("");
  }

  const bodyXml = blocksXml(S.blocks) +
    (S.answers && S.answers.length
      ? para("", { pageBreakBefore: true }) + blocksXml(S.answers)
      : "");

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document ' + NS_STR + '><w:body>' + bodyXml +
    "<w:sectPr>" +
    '<w:pgSz w:w="' + PAGE.w + '" w:h="' + PAGE.h + '"/>' +
    '<w:pgMar w:top="' + PAGE.mTop + '" w:right="' + PAGE.mRight + '" w:bottom="' + PAGE.mBottom +
    '" w:left="' + PAGE.mLeft + '" w:header="851" w:footer="992" w:gutter="0"/>' +
    "</w:sectPr></w:body></w:document>";

  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.map(function (r) {
      return '<Relationship Id="' + r[0] + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r[1] + '"/>';
    }).join("") +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:docDefaults><w:rPrDefault><w:rPr>" +
    '<w:rFonts w:ascii="' + FONT_SONG + '" w:hAnsi="' + FONT_SONG + '" w:eastAsia="' + FONT_SONG + '" w:cs="' + FONT_SONG + '"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    "</w:styles>";

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    "</Types>";

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const files = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(documentRels, "utf8") },
  ];
  Object.keys(media).forEach(function (k) {
    files.push({ name: "word/" + media[k].name, data: media[k].buf });
  });

  return zipStore(files);
}

const NS_STR = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

module.exports = { buildDocx: buildDocx, zipStore: zipStore, crc32: crc32, BODY_W_PX: BODY_W_PX };
