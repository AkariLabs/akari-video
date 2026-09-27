// 検証専用 fixture（ラッパー作成）。横長 1920×1080・10 秒。
// 字幕（話した言葉）と置いた文字を、低い（1 行・小さい文字）/ 高い（複数行・大きい文字）で 2 秒ずつ並べる。
//   0–2 秒 sp-low  : 話した言葉・1 行・28px
//   2–4 秒 sp-high : 話した言葉・長文（折り返し）・72px
//   4–6 秒 pt-low  : 置いた文字（akari.caption.placeText の既定 = tc・y だけ）・1 行・28px
//   6–8 秒 pt-high : 置いた文字（ドラッグ後 = x と y）・2 行・72px
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`); };

export const CASES = [
  { key: 'sp-low', id: 'c-0001', at: 1, kind: 'spoken', height: 'low', text: '短い字幕の横幅' },
  { key: 'sp-high', id: 'c-0002', at: 3, kind: 'spoken', height: 'high', text: 'この字幕はとても長いので画面の幅に収まらずに何行かへ折り返されるはずです' },
  { key: 'pt-low', id: 'c-0101', at: 5, kind: 'placed', height: 'low', text: '置いた文字の横幅' },
  { key: 'pt-high', id: 'c-0102', at: 7, kind: 'placed', height: 'high', text: '置いた文字の一行目\n二行目はこちらです' },
];

export default async function fixture({ project, editPath, seconds = 10 }) {
  const W = 1920, H = 1080, FPS = 30, SEC = seconds;
  const assets = path.join(project, 'assets');
  await mkdir(assets, { recursive: true });
  run(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
    `color=c=0x4b5563:s=${W}x${H}:d=${SEC}:r=${FPS}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', path.join(assets, 'base.mp4')]);
  const D = SEC * FPS;
  const edit = {
    version: 2, output: { width: W, height: H, fps: FPS },
    sources: [{ id: 'base', path: 'assets/base.mp4' }],
    tracks: [
      { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: D, source: { kind: 'media', src: 'base', in: 0, out: SEC } }] },
      { id: 'v-text', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: D, source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    ],
  };
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  const span = at => ({ start: at - 1, end: Math.min(SEC, at + 1) });
  const captions = { default_text_style: { zone: 'bottom' }, captions: [
    { id: 'c-0001', ...span(1), text: CASES[0].text, speaker: null, sourceRef: { segment: 0 }, edited: false,
      text_style: { size_px: 28 } },
    { id: 'c-0002', ...span(3), text: CASES[1].text, speaker: null, sourceRef: { segment: 1 }, edited: false,
      text_style: { size_px: 72 } },
    { id: 'c-0101', ...span(5), time_domain: 'output', text: CASES[2].text, speaker: null, sourceRef: null, edited: true,
      text_style: { position: { y: 0.3 }, text_anchor: 'tc', size_px: 28 } },
    { id: 'c-0102', ...span(7), time_domain: 'output', text: CASES[3].text, speaker: null, sourceRef: null, edited: true,
      text_style: { position: { x: 0.25, y: 0.25 }, text_anchor: 'tc', size_px: 72 } },
  ] };
  await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
}
