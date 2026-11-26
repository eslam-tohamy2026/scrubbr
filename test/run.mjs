import { readFileSync, writeFileSync } from 'node:fs';
import { scrub } from '../src/scrub.js';
import { execFileSync } from 'node:child_process';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

let hasExif = true;
try { execFileSync('exiftool', ['-ver']); } catch { hasExif = false; }
if (!hasExif) console.log('NOTE: exiftool not found, skipping exiftool verification (install it for the full check)');

for (const f of ['photo.jpg', 'photo.png', 'photo.webp', 'memo.docx', 'magick.png']) {
  const r = await scrub(new Uint8Array(readFileSync(new URL(f, import.meta.url))));
  ok(r.found.length > 0, `${f}: detects metadata`);
  const again = await scrub(r.clean);
  ok(again.found.length === 0, `${f}: clean output has nothing left`);
  if (hasExif && f !== 'memo.docx') { writeFileSync('/tmp/_t.' + f.split('.')[1], r.clean); const o = execFileSync('exiftool', ['-gps:all', '-Make', '-Artist', '-SerialNumber', '/tmp/_t.' + f.split('.')[1]]).toString(); ok(o.trim() === '', `${f}: exiftool sees no GPS/make/artist/serial`); }
}

// Office timestamps and revision counts are removed, not just reported
{
  const r = await scrub(new Uint8Array(readFileSync(new URL('memo.docx', import.meta.url))));
  const keys = r.found.map((x) => x.key);
  ok(keys.includes('Created') && keys.includes('Modified') && keys.includes('Revision count'), 'memo.docx: reports created/modified/revision');
  if (hasExif) {
    writeFileSync('/tmp/_t.docx', r.clean);
    const o = execFileSync('exiftool', ['-CreateDate', '-ModifyDate', '-RevisionNumber', '-Creator', '-LastModifiedBy', '/tmp/_t.docx']).toString();
    const leaks = o.split('\n').filter((l) => l.includes(':') && l.split(':').slice(1).join(':').trim() !== '');
    ok(leaks.length === 0, 'memo.docx: exiftool sees no dates/revision/author after scrub' + (leaks.length ? ' -> ' + leaks.join('; ') : ''));
  }
}

// ImageMagick-style date:text chunks are reported (they used to be removed silently)
{
  const r = await scrub(new Uint8Array(readFileSync(new URL('magick.png', import.meta.url))));
  ok(r.found.some((x) => x.key === 'Text: date:modify'), 'magick.png: date:modify chunk is listed');
}

process.exit(fail);
