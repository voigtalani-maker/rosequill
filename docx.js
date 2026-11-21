'use strict';
/* Real Word (.docx) files, built in the browser with no library: a small ZIP writer plus WordprocessingML.
   Used by Compile → Word, by the folder backup (a .docx next to the JSON backup) and by the Backups window.
   Headings use Word's own "heading 1/2/3" styles, so the Navigation Pane and table of contents work. */
const Word = (() => {
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const xe = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- inline markdown → runs ---------- */
  function runs(text) {
    const lit = [];
    text = String(text).replace(/\\([\\`*_[\]#~=|>!()-])/g, (m, c) => { lit.push(c); return '\u0002' + (lit.length - 1) + '\u0002'; })
      .replace(/\[\[([^\][|\n]+)\|([^\][\n]+)\]\]/g, '$2').replace(/\[\[([^\][\n]+)\]\]/g, '$1'); // a link never contains another [
    const back = s => s.replace(/\u0002(\d+)\u0002/g, (m, i) => lit[i]);
    const re = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\[[^\]\n]+\]\(https?:[^)\s]+\)|(?<![\p{L}\p{N}*])\*[^*\n]+\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_]))/gu;
    const out = []; let last = 0, m;
    const run = (t, pr) => { if (t) out.push(`<w:r>${pr ? '<w:rPr>' + pr + '</w:rPr>' : ''}<w:t xml:space="preserve">${xe(back(t))}</w:t></w:r>`); };
    while ((m = re.exec(text))) {
      run(text.slice(last, m.index));
      const t = m[0];
      if (t.startsWith('**')) run(t.slice(2, -2), '<w:b/>');
      else if (t.startsWith('~~')) run(t.slice(2, -2), '<w:strike/>');
      else if (t.startsWith('==')) run(t.slice(2, -2), '<w:highlight w:val="yellow"/>');
      else if (t.startsWith('`')) run(t.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
      else if (t.startsWith('[')) { const mm = t.match(/^\[([^\]]+)\]\((.+)\)$/); run(mm[1] + ' (' + mm[2] + ')'); }
      else run(t.slice(1, -1), '<w:i/>');
      last = m.index + t.length;
    }
    run(text.slice(last));
    return out.join('');
  }
  const para = (style, inner) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
  const tab = t => `<w:r><w:t xml:space="preserve">${xe(t)}</w:t></w:r><w:r><w:tab/></w:r>`;

  /* ---------- block markdown → paragraphs (same rules as the app's Read mode) ---------- */
  function body(mdText) {
    const out = [], lines = String(mdText).replace(/\r/g, '').split('\n'); let buf = [];
    const flush = () => { if (buf.length) { out.push(para('', buf.map(runs).join('<w:r><w:br/></w:r>'))); buf = []; } };
    for (const line of lines) {
      let m;
      if (/^\s*$/.test(line)) { flush(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push(para('Heading' + Math.min(m[1].length, 3), runs(m[2]))); continue; }
      if (/^\s*(\*\s*\*\s*\*|-{3,}|_{3,}|(✦\s*){1,5}|❦|#)\s*$/.test(line)) { flush(); out.push(para('SceneBreak', '<w:r><w:t xml:space="preserve">✦     ✦     ✦</w:t></w:r>')); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push(para('Quote', runs(m[1]))); continue; }
      if ((m = line.match(/^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/))) { flush(); out.push(para('ListPara', tab(m[1] ? (m[1] === ' ' ? '☐' : '☑') : '•') + runs(m[2]))); continue; }
      if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) { flush(); out.push(para('ListPara', tab(m[1] + '.') + runs(m[2]))); continue; }
      buf.push(line);
    }
    flush();
    return out.join('');
  }

  /* ---------- package parts ---------- */
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-ZA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="425"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="3600" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="7A1F4F"/><w:sz w:val="60"/><w:szCs w:val="60"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="600" w:after="360"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="7A1F4F"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:color w:val="7A1F4F"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:i/><w:color w:val="9B3D6E"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="120"/><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SceneBreak"><w:name w:val="Scene break"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="B06A8F"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ListPara"><w:name w:val="List item"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
</w:styles>`;
  function documentXml(title, author, mdText, titlePage) {
    let b = '';
    if (titlePage) {
      b += para('Title', `<w:r><w:t xml:space="preserve">${xe(title)}</w:t></w:r>`);
      if (author) b += para('Subtitle', `<w:r><w:t xml:space="preserve">${xe(author)}</w:t></w:r>`);
      // A chapter heading starts its own page anyway; otherwise break after the title page.
      if (!/^\s*#\s/.test(mdText)) b += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    b += body(mdText) || para('', '');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${b}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  }
  const iso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  function parts(title, author, mdText, titlePage) {
    return [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/document.xml', documentXml(title, author, mdText, titlePage)],
      ['word/styles.xml', STYLES],
      ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(title)}</dc:title><dc:creator>${xe(author || 'Rosequill')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso()}</dcterms:modified></cp:coreProperties>`],
    ];
  }

  /* ---------- a tiny ZIP writer (files stored uncompressed, which Word accepts) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = []; let off = 0, cdSize = 0;
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, text] of files) {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      chunks.push(h.buffer, nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true);
      c.setUint32(42, off, true);
      central.push(c.buffer, nb); cdSize += 46 + nb.length;
      off += 30 + nb.length + data.length;
    }
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob([...chunks, ...central, e.buffer], { type: MIME });
  }

  /* ---------- public ---------- */
  const build = (title, author, mdText, titlePage = true) => zip(parts(title, author, mdText, titlePage));
  // A whole grimoire for backups: the book (every Manuscript page, in order), then Lore & Notes and Research.
  function projectDocx(p) {
    const base = { project: p, stripTags: false, skipIdeas: false }; // a backup keeps everything, #tags included
    const book = compileMd({ ...base, folder: p.roots.manuscript, folderTitles: true, docTitles: true, sep: true }).md;
    const side = root => compileMd({ ...base, folder: p.roots[root], folderTitles: true, docTitles: true, sep: false, shift: 1, docLevel: 2 }).md;
    let md = book.trim() ? book : '';
    const lore = side('lore'), research = side('research');
    if (lore.trim()) md += '\n\n# Lore & Notes\n\n' + lore;
    if (research.trim()) md += '\n\n# Research\n\n' + research;
    return build(p.name, p.author, md.trim() + '\n', true);
  }
  return { build, projectDocx, MIME, _body: body };
})();
