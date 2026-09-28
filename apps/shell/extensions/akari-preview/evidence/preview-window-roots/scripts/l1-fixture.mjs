// l1-fixture.mjs <tag> — C:/t/pwr/<tag>/{ws-a,ws-b} に test-project を複製し、主動画を assets/ 配下へ移す。
import { cpSync, mkdirSync, renameSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const tag = process.argv[2] ?? 'before';
const src = process.env.AKARI_WT + '/test-project';
const base = `C:/t/pwr/${tag}`;
if (existsSync(base)) rmSync(base, { recursive: true, force: true });
for (const name of ['ws-a', 'ws-b']) {
  const ws = join(base, name);
  cpSync(src, ws, { recursive: true });
  mkdirSync(join(ws, 'assets'), { recursive: true });
  renameSync(join(ws, 'source.mp4'), join(ws, 'assets', 'source.mp4'));
  const editPath = join(ws, 'edit.json');
  const edit = JSON.parse(readFileSync(editPath, 'utf8'));
  for (const s of edit.sources) if (s.path === 'source.mp4') s.path = 'assets/source.mp4';
  writeFileSync(editPath, JSON.stringify(edit, null, 2) + '\n');
}
for (const d of ['userdata', 'theia-config', 'akari-home']) mkdirSync(join(base, d), { recursive: true });
console.log(JSON.stringify({ base, ok: true }));
