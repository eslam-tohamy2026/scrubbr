// scrubbr core: pure functions, no dependencies, runs in browser and Node.
const td = new TextDecoder('utf-8', { fatal: false });
const te = new TextEncoder();
const u16 = (d, o, le) => d.getUint16(o, le);
const u32 = (d, o, le) => d.getUint32(o, le);

export function detect(bytes) {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (td.decode(b.subarray(0, 4)) === 'RIFF' && td.decode(b.subarray(8, 12)) === 'WEBP') return 'webp';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'ooxml';
  return 'unknown';
}

/* ---------- EXIF ---------- */
const TAGS = {
  0x010f: 'Camera make', 0x0110: 'Camera model', 0x0131: 'Software', 0x0132: 'Modified',
  0x013b: 'Author', 0x8298: 'Copyright', 0x010e: 'Description', 0x9003: 'Taken',
  0xa431: 'Body serial number', 0xa432: 'Lens info', 0xa434: 'Lens model', 0xa435: 'Lens serial number',
  0x9286: 'User comment', 0xc62f: 'Camera serial number', 0xa430: 'Owner name',
};
function readExif(tiff) {
  const out = [];
  if (tiff.length < 8) return out;
  const d = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const le = td.decode(tiff.subarray(0, 2)) === 'II';
  const str = (o, n) => td.decode(tiff.subarray(o, o + n)).replace(/\0+$/, '').trim();
  const rat = (o) => { const n = u32(d, o, le), m = u32(d, o + 4, le); return m ? n / m : 0; };
  const ifd = (off, depth, gps) => {
    if (off + 2 > tiff.length || depth > 4) return;
    const n = u16(d, off, le);
    const g = {};
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > tiff.length) break;
      const tag = u16(d, e, le), type = u16(d, e + 2, le), cnt = u32(d, e + 4, le);
      const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type] || 1;
      const vo = size * cnt <= 4 ? e + 8 : u32(d, e + 8, le);
      if (vo + size * cnt > tiff.length) continue;
      if (gps) {
        if (type === 2) g[tag] = str(vo, cnt);
        if (type === 5) g[tag] = [0, 1, 2].map((k) => rat(vo + k * 8));
        continue;
      }
      if (tag === 0x8769 || tag === 0xa005) ifd(u32(d, e + 8, le), depth + 1, false);
      else if (tag === 0x8825) ifd(u32(d, e + 8, le), depth + 1, true);
      else if (TAGS[tag] && type === 2) { const v = str(vo, cnt); if (v) out.push({ key: TAGS[tag], value: v, risk: /serial|owner|author/i.test(TAGS[tag]) ? 'high' : 'low' }); }
      else if (tag === 0x0112 || tag === 0x9201) { /* orientation/shutter: harmless */ }
    }
    if (gps && g[2] && g[4]) {
      const toDec = (a, ref) => (a[0] + a[1] / 60 + a[2] / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1);
      const lat = toDec(g[2], g[1]), lon = toDec(g[4], g[3]);
      out.push({ key: 'GPS location', value: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, risk: 'high', lat, lon });
    }
  };
  ifd(u32(d, 4, le), 0, false);
  return out;
}

/* ---------- JPEG ---------- */
function jpeg(b) {
  const found = []; const keep = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const m = b[i + 1];
    if (m === 0xda || m === 0xd9) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i, i + 2 + len);
    const body = b.subarray(i + 4, i + 2 + len);
    const head = td.decode(body.subarray(0, 29));
    let drop = false;
    if (m === 0xe1 && head.startsWith('Exif\0\0')) { drop = true; found.push(...readExif(body.subarray(6))); }
    else if (m === 0xe1 && head.startsWith('http://ns.adobe.com/xap')) { drop = true; found.push({ key: 'XMP block', value: `${body.length} bytes (editing history, creator tool)`, risk: 'med' }); }
    else if (m === 0xed) { drop = true; found.push({ key: 'Photoshop/IPTC block', value: `${body.length} bytes (captions, keywords, credits)`, risk: 'med' }); }
    else if (m === 0xe2 && head.startsWith('MPF')) { drop = true; found.push({ key: 'Multi-picture data', value: 'embedded extra images', risk: 'med' }); }
    else if (m === 0xfe) { drop = true; found.push({ key: 'JPEG comment', value: td.decode(body).slice(0, 80), risk: 'low' }); }
    else if (m >= 0xe3 && m <= 0xef && m !== 0xee) { drop = true; found.push({ key: `APP${m - 0xe0} block`, value: `${body.length} bytes`, risk: 'low' }); }
    if (!drop) keep.push(seg);
    i += 2 + len;
  }
  keep.push(b.subarray(i));
  return { found, clean: concat(keep) };
}

/* ---------- PNG ---------- */
function png(b) {
  const found = []; const keep = [b.subarray(0, 8)];
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  while (i + 12 <= b.length) {
    const len = u32(d, i, false); const type = td.decode(b.subarray(i + 4, i + 8));
    const end = i + 12 + len;
    if (drop.has(type)) {
      const body = b.subarray(i + 8, i + 8 + len);
      if (type === 'eXIf') found.push(...readExif(body));
      else if (type === 'tIME') found.push({ key: 'Modified', value: `${u16(d, i + 8, false)}-${b[i + 10]}-${b[i + 11]}`, risk: 'low' });
      else {
        const z = body.indexOf(0);
        const key = td.decode(body.subarray(0, z));
        const low = /^(exif|date|png):/.test(key);
        found.push({ key: `Text: ${key}`, value: type === 'tEXt' ? td.decode(body.subarray(z + 1)).slice(0, 80) : '(compressed text)', risk: low ? 'low' : 'med' });
      }
    } else keep.push(b.subarray(i, end));
    i = end;
  }
  return { found, clean: concat(keep) };
}

/* ---------- WebP ---------- */
function webp(b) {
  const found = []; const keep = [];
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 12;
  while (i + 8 <= b.length) {
    const type = td.decode(b.subarray(i, i + 4)); const len = u32(d, i + 4, true);
    const end = Math.min(i + 8 + len + (len & 1), b.length);
    if (type === 'EXIF') { found.push(...readExif(b.subarray(i + 8, i + 8 + len).subarray(td.decode(b.subarray(i + 8, i + 14)) === 'Exif\0\0' ? 6 : 0))); }
    else if (type === 'XMP ') found.push({ key: 'XMP block', value: `${len} bytes`, risk: 'med' });
    if (type === 'EXIF' || type === 'XMP ' ) { /* drop */ }
    else if (type === 'VP8X') { const c = b.slice(i, end); c[8] &= ~(0x08 | 0x04); keep.push(c); }
    else keep.push(b.subarray(i, end));
    i = end;
  }
  const body = concat(keep);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12)); out.set(body, 12);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return { found, clean: out };
}

/* ---------- OOXML (docx/xlsx/pptx): raw-copy zip rewrite, no recompression ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function readZip(b) {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22; while (e >= 0 && u32(d, e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a valid zip/Office file');
  const n = u16(d, e + 10, true); let p = u32(d, e + 16, true); const ents = [];
  for (let i = 0; i < n; i++) {
    const nl = u16(d, p + 28, true), xl = u16(d, p + 30, true), cl = u16(d, p + 32, true);
    const lho = u32(d, p + 42, true);
    const lnl = u16(d, lho + 26, true), lxl = u16(d, lho + 28, true);
    const csize = u32(d, p + 20, true);
    ents.push({
      name: td.decode(b.subarray(p + 46, p + 46 + nl)), method: u16(d, p + 10, true),
      crc: u32(d, p + 16, true), csize, usize: u32(d, p + 24, true), time: u16(d, p + 12, true), date: u16(d, p + 14, true),
      flags: u16(d, p + 8, true) & 0x0800, data: b.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize),
    });
    p += 46 + nl + xl + cl;
  }
  return ents;
}
function writeZip(ents) {
  const parts = []; const cds = []; let off = 0;
  const h = (n) => { const a = new Uint8Array(n); return [a, new DataView(a.buffer)]; };
  for (const e of ents) {
    const nm = te.encode(e.name);
    const [l, ld] = h(30);
    ld.setUint32(0, 0x04034b50, true); ld.setUint16(4, 20, true); ld.setUint16(6, e.flags, true); ld.setUint16(8, e.method, true);
    ld.setUint16(10, e.time, true); ld.setUint16(12, e.date, true); ld.setUint32(14, e.crc, true);
    ld.setUint32(18, e.csize, true); ld.setUint32(22, e.usize, true); ld.setUint16(26, nm.length, true);
    parts.push(l, nm, e.data);
    const [c, cd] = h(46);
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, e.flags, true); cd.setUint16(10, e.method, true);
    cd.setUint16(12, e.time, true); cd.setUint16(14, e.date, true); cd.setUint32(16, e.crc, true);
    cd.setUint32(20, e.csize, true); cd.setUint32(24, e.usize, true); cd.setUint16(28, nm.length, true); cd.setUint32(42, off, true);
    cds.push(c, nm);
    off += 30 + nm.length + e.csize;
  }
  const cdBytes = concat(cds); const [eo, ed] = h(22);
  ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, ents.length, true); ed.setUint16(10, ents.length, true);
  ed.setUint32(12, cdBytes.length, true); ed.setUint32(16, off, true);
  return concat([...parts, cdBytes, eo]);
}
async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter(); w.write(data); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
function xmlField(xml, tag) { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`)); return m ? m[1].trim() : ''; }
const CORE = ['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'cp:keywords', 'dc:description', 'cp:category'];
// These are removed as whole elements (empty date fields can make Office complain).
const REMOVE = ['cp:revision', 'cp:lastPrinted', 'dcterms:created', 'dcterms:modified'];
const APP = ['Company', 'Manager', 'Application', 'AppVersion'];
const LABEL = { 'dc:creator': 'Author', 'cp:lastModifiedBy': 'Last modified by', 'dc:title': 'Title', 'dc:subject': 'Subject', 'cp:keywords': 'Keywords', 'dc:description': 'Description', 'cp:category': 'Category', 'cp:revision': 'Revision count', 'cp:lastPrinted': 'Last printed', 'dcterms:created': 'Created', 'dcterms:modified': 'Modified', Company: 'Company', Manager: 'Manager', Application: 'Application', AppVersion: 'App version' };
async function ooxml(b) {
  const ents = readZip(b); const found = []; const out = [];
  const stored = (e, text) => { const data = te.encode(text); return { ...e, method: 0, data, csize: data.length, usize: data.length, crc: crc32(data) }; };
  for (const e of ents) {
    if (e.name === 'docProps/core.xml' || e.name === 'docProps/app.xml') {
      const xml = td.decode(e.method === 0 ? e.data : await inflateRaw(e.data));
      const isCore = e.name.endsWith('core.xml');
      const tags = isCore ? CORE : APP;
      let clean = xml;
      for (const t of tags) { const v = xmlField(xml, t); if (v) { found.push({ key: LABEL[t] || t, value: v, risk: /creator|modifiedBy|Company|Manager/.test(t) ? 'high' : 'low' }); clean = clean.replace(new RegExp(`(<${t}[^>]*>)[^<]*(</${t}>)`), '$1$2'); } }
      if (isCore) {
        for (const t of REMOVE) {
          const re = new RegExp(`<${t}[^>]*(?:/>|>([^<]*)</${t}>)`);
          const m = clean.match(re);
          if (m) {
            const v = (m[1] || '').trim();
            if (v) found.push({ key: LABEL[t] || t, value: v, risk: 'low' });
            clean = clean.replace(re, '');
          }
        }
      }
      out.push(stored(e, clean));
    } else if (e.name === 'docProps/custom.xml') {
      found.push({ key: 'Custom properties', value: 'removed', risk: 'med' });
      out.push(stored(e, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>'));
    } else if (/^(word|ppt|xl)\/(comments|commentAuthors|persons\/person)/.test(e.name) || /^xl\/threadedComments\//.test(e.name)) {
      found.push({ key: 'Comments / reviewer names', value: e.name, risk: 'high' });
      out.push(e);
    } else if (/^docProps\/thumbnail\./.test(e.name)) {
      found.push({ key: 'Document thumbnail', value: 'preview image of page 1 (can leak content)', risk: 'med' });
      continue;
    } else out.push(e);
  }
  const thumb = ents.some((e) => /^docProps\/thumbnail\./.test(e.name));
  let clean = writeZip(out);
  return { found, clean, note: thumb ? 'Thumbnail removed (its content-type entry is harmless).' : '', warn: found.some((f) => f.key.startsWith('Comments')) ? 'Comments and tracked changes are reported but left in place so we never edit your content. Review them in the app.' : '' };
}

export function concat(arrs) {
  const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0;
  for (const a of arrs) { o.set(a, p); p += a.length; } return o;
}

export async function scrub(bytes) {
  const kind = detect(bytes);
  if (kind === 'jpeg') return { kind, ...jpeg(bytes) };
  if (kind === 'png') return { kind, ...png(bytes) };
  if (kind === 'webp') return { kind, ...webp(bytes) };
  if (kind === 'ooxml') return { kind, ...(await ooxml(bytes)) };
  throw new Error('Unsupported file type. scrubbr handles JPEG, PNG, WebP, DOCX, XLSX and PPTX.');
}
