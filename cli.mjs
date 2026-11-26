#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { scrub } from './src/scrub.js';

const usage = (code) => {
  console.log('usage: scrubbr <file> [output]');
  console.log('  Cleans metadata from JPEG, PNG, WebP, DOCX, XLSX and PPTX.');
  console.log('  Default output: <name>.clean.<ext> next to the input.');
  process.exit(code);
};

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) usage(0);
if (args.includes('--version')) {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
  console.log(pkg.version);
  process.exit(0);
}
const [file, out] = args;
if (!file || args.length > 2) usage(2);

let bytes;
try { bytes = readFileSync(file); } catch { console.error(`scrubbr: cannot read ${file}`); process.exit(2); }

let r;
try { r = await scrub(new Uint8Array(bytes)); } catch (err) { console.error(`scrubbr: ${err.message}`); process.exit(1); }

console.log(`${file} (${r.kind}): ${r.found.length} item(s) found`);
for (const f of r.found) console.log(`  [${f.risk}] ${f.key}: ${f.value}`);
if (r.warn) console.log(`  note: ${r.warn}`);

const o = out || (/(\.[^./\\]+)$/.test(file) ? file.replace(/(\.[^./\\]+)$/, '.clean$1') : file + '.clean');
if (o === file) { console.error('scrubbr: output would overwrite the input; pass an output path'); process.exit(2); }
try { writeFileSync(o, r.clean); } catch { console.error(`scrubbr: cannot write ${o}`); process.exit(2); }
console.log(`clean copy -> ${o}`);
