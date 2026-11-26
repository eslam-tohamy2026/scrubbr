#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { scrub } from './src/scrub.js';
const [, , file, out] = process.argv;
if (!file) { console.error('usage: scrubbr <file> [output]'); process.exit(2); }
const r = await scrub(new Uint8Array(readFileSync(file)));
console.log(`${file} (${r.kind}): ${r.found.length} item(s) found`);
for (const f of r.found) console.log(`  [${f.risk}] ${f.key}: ${f.value}`);
if (r.warn) console.log(`  note: ${r.warn}`);
const o = out || file.replace(/(\.[^.]+)$/, '.clean$1');
writeFileSync(o, r.clean); console.log(`clean copy -> ${o}`);
