import { scrub } from './scrub.js';
const $ = (s) => document.querySelector(s);
const drop = $('#drop'), pick = $('#pick'), out = $('#out');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('on'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('on'); }));
drop.addEventListener('drop', (e) => handle(e.dataTransfer.files));
pick.addEventListener('change', () => handle(pick.files));
export async function handle(files) {
  for (const f of files) {
    const card = document.createElement('div'); card.className = 'file'; out.prepend(card);
    try {
      const r = await scrub(new Uint8Array(await f.arrayBuffer()));
      const name = f.name.replace(/(\.[^.]+)$/, '.clean$1');
      const url = URL.createObjectURL(new Blob([r.clean]));
      const prev = r.kind === 'ooxml' ? '' : `<img class="prev" src="${URL.createObjectURL(new Blob([r.clean]))}" alt="">`;
      const gps = r.found.find((x) => x.lat != null);
      const rows = r.found.map((x) => `<tr><td><span class="pill ${x.risk}">${x.risk}</span>${esc(x.key)}</td><td>${esc(x.value)}</td></tr>`).join('');
      card.innerHTML = `${prev}<h3>${esc(f.name)}</h3><div class="meta">${r.kind.toUpperCase()} · ${kb(f.size)} → ${kb(r.clean.length)}</div>
      <div class="verdict ${r.found.length ? 'bad' : 'good'}">${r.found.length ? `Found ${r.found.length} hidden item(s). The clean copy has none of them.` : 'No hidden metadata found.'}</div>
      ${gps ? `<div class="note">This file reveals where it was taken: <a style="color:#38bdf8" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=16/${gps.lat}/${gps.lon}">open that spot on a map</a> (opens a map site only when you click).</div>` : ''}
      ${rows ? `<table>${rows}</table>` : ''}
      ${r.warn ? `<div class="note">${esc(r.warn)}</div>` : ''}
      <a class="btn" href="${url}" download="${esc(name)}">Download clean copy</a>`;
    } catch (err) { card.innerHTML = `<h3>${esc(f.name)}</h3><div class="verdict bad">${esc(err.message)}</div>`; }
  }
}
