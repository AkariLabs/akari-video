#!/usr/bin/env node
// (c) 用: 置いた文字 <captionId> を字幕の袋の exclude に入れ、caption item を写真の段（v-photo）の下（under）/ 上（over）の
// 新しい段に手で書いた edit.json を、プロジェクトの git HEAD の edit.json から作って上書きする（ラッパー作成の検証スクリプト）。
// 使い方: node make-hand.mjs <project> <under|over> [captionId=c-0005]
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const [project, where, captionId = 'c-0005'] = process.argv.slice(2);
const edit = JSON.parse(execFileSync('/usr/bin/git', ['show', 'HEAD:edit.json'], { cwd: project, encoding: 'utf8' }));
const captions = JSON.parse(execFileSync('/usr/bin/git', ['show', 'HEAD:captions.json'], { cwd: project, encoding: 'utf8' }));
const row = captions.captions.find(c => c.id === captionId);
const fps = edit.output.fps;
const bag = edit.tracks.flatMap(t => t.items ?? []).find(i => i.source?.kind === 'captions');
bag.source.exclude = [...(bag.source.exclude ?? []), captionId];
const item = { id: `cap-${captionId}`, at: Math.round(row.start * fps), duration: Math.round((row.end - row.start) * fps),
    source: { kind: 'caption', path: 'captions.json', id: captionId } };
const photoIndex = edit.tracks.findIndex(t => t.id === 'v-photo');
edit.tracks.splice(where === 'under' ? photoIndex : photoIndex + 1, 0,
    { id: `v-text-${where}`, lane: 'visual', name: `文字-${where}`, items: [item] });
await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
console.log(JSON.stringify({ where, tracks: edit.tracks.map(t => t.id), item }));
