// 検証用（ラッパー所掌）: render-cut の行分け関数（統合ブランチ）にお手本の字幕 22 件をかけて行数を数える
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const WT = '<WORKTREE>';
const { splitCaptionLines } = await import(pathToFileURL(`${WT}/packages/render-cut/src/captions.mjs`));
const caps = JSON.parse(await readFile('C:/t/oif/demo/captions.json', 'utf8')).captions;
const rows = caps.map(c => { const t = c.display_text ?? c.text; const lines = splitCaptionLines(t); return { id: c.id, text: t, lines }; });
for (const r of rows) console.log(r.id, r.lines.length, JSON.stringify(r.lines));
console.log('multi-line:', rows.filter(r => r.lines.length !== 1).map(r => r.id));
