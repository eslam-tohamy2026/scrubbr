import { readFileSync } from 'node:fs';
import { scrub } from '../src/scrub.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
for (const f of ['photo.jpg', 'photo.png', 'photo.webp', 'memo.docx']) {
  const r = await scrub(new Uint8Array(readFileSync(new URL(f, import.meta.url))));
  ok(r.found.length > 0, `${f}: detects metadata`);
  const again = await scrub(r.clean);
  ok(again.found.length === 0, `${f}: clean output has nothing left`);
  if (f !== 'memo.docx') { writeFileSync('/tmp/_t.' + f.split('.')[1], r.clean); const o = execFileSync('exiftool', ['-gps:all', '-Make', '-Artist', '-SerialNumber', '/tmp/_t.' + f.split('.')[1]]).toString(); ok(o.trim() === '', `${f}: exiftool sees no GPS/make/artist/serial`); }
}
process.exit(fail);
