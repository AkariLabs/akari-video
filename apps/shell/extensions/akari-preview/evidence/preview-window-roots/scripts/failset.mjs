import { readFileSync } from 'node:fs';
const text = readFileSync(process.argv[2], 'utf8');
const idx = text.indexOf('✖ failing tests:');
const part = idx >= 0 ? text.slice(idx) : text;
const set = new Set();
let file = '';
for (const line of part.split(/\r?\n/)) {
  const fm = line.match(/^test at (.+?):\d+:\d+$/);
  if (fm) { file = fm[1].split(String.fromCharCode(92)).join('/').replace(/.*\/test\//, 'test/'); continue; }
  const m = line.match(/^\s*✖ (.+?)(?: \([\d.]+m?s\))?$/);
  if (m && m[1] !== 'failing tests:') set.add(`${file} :: ${m[1]}`);
}
console.log([...set].sort().join('\n'));
