// 検証用（ラッパー所掌）: full から計測用の 3 本（noov / novoice / sfxonly）を作る
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const base = 'C:/t/odt-1001/full';
const make = (name, fn) => {
  const dir = `C:/t/odt-1001/${name}`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(base, dir, { recursive: true, filter: src => !src.replaceAll('\\', '/').includes('/exports') });
  const edit = JSON.parse(readFileSync(`${dir}/edit.json`, 'utf8'));
  fn(edit);
  writeFileSync(`${dir}/edit.json`, JSON.stringify(edit, null, 2) + '\n');
  console.log(name, JSON.stringify(edit.tracks.map(t => [t.id, t.muted ?? false])));
};
const OVERLAY = new Set(['demo-phone-screen', 'demo-flash', 'demo-stage', 'demo-accents']);
make('noov', e => { e.tracks = e.tracks.filter(t => !OVERLAY.has(t.id)); });
make('novoice', e => { e.tracks.find(t => t.id === 'video').muted = true; });
make('sfxonly', e => { e.tracks.find(t => t.id === 'video').muted = true; e.tracks.find(t => t.id === 'onboarding-bgm').muted = true; });
