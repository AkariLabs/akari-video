#!/usr/bin/env node
// ビート同期タイムライン生成器（ひな形）
//
//   <project>/.akari/work/gen-timeline.mjs にコピーして書き換える。
//   前提: .akari/work/beatmap.json（skills/beat-sync-edit/bin/beatmap.mjs で生成）
//   実行: node .akari/work/gen-timeline.mjs
//
// 規律:
//   - 時刻は B(拍番号) からのみ作る。秒の直書きをしない
//   - edit.json / overlays/*.html は毎回まるごと作り直す（部分更新を作らない）
//   - 直しは「この生成器の 1 箇所」を変えて再実行する
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const bm = JSON.parse(fs.readFileSync(path.join(ROOT, '.akari/work/beatmap.json'), 'utf8'));
const { beats, beat_intensity: bi, env30, duration: DUR, bpm } = bm;
const BEAT = bm.beat;

const B = (n) => beats[n];                       // 拍番号 → 秒
const r3 = (x) => Math.round(x * 1000) / 1000;

// ---------- 見た目の定数（レビュー指摘の多くはここ 1 箇所で直る） ----------
const ACCENT = '#f9803a';
const TEXT = '#f5f1ea';
const FONT = `var(--font-family, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif)`;
const TITLE_SIZE = 114;   // 大判タイポ。PV はマージンを攻めてよい
const CHIP_SIZE = 40;

// ---------- 収集先 ----------
const overlays = [];   // { id, html, start, duration, vars? }
const sfx = [];        // { path, t, gain_db }
const SFX_DIR = 'assets/sfx';

const S = (name, t, gain = 0) => {
  const cand = [`${SFX_DIR}/${name}.wav`, `${SFX_DIR}/sfx-${name}.wav`];
  const found = cand.find((p) => fs.existsSync(path.join(ROOT, p))) ?? cand[0];
  sfx.push({ path: found, t: r3(t), gain_db: gain });
};
const OV = (id, file, start, duration, vars) => overlays.push({
  id, html: `overlays/${file}`, start: r3(start), duration: r3(duration), ...(vars ? { vars } : {}),
});
const W = (file, html) => fs.writeFileSync(path.join(ROOT, 'overlays', file), html);

// 断片の共通部品
const ACT = (sel) => `[data-akari-active] ${sel}, [data-no-timeline] ${sel}`;
const stage = (cls, extra = '') => `
    .${cls}__stage {
      position: relative;
      inline-size: var(--stage-width, 100%);
      block-size: var(--stage-height, 100%);
      overflow: hidden;
      pointer-events: none;
      font-family: ${FONT};
      ${extra}
    }`;

// 画像は data URI で焼き込む（シートは .akari/render-tmp/ に置かれ相対パスが崩れるため）
const dataUri = (relJpeg) =>
  `data:image/jpeg;base64,${fs.readFileSync(path.join(ROOT, relJpeg)).toString('base64')}`;

// =========================================================
// 1. 音反応の背景（拍ごとの実測強度を 1 本の keyframes に焼き込む）
// =========================================================
{
  const stops = ['0% { opacity: 0.08; }'];
  const p = (x) => r3((x / DUR) * 100);
  beats.forEach((t, n) => {
    const hi = 0.12 + 0.6 * (bi[n] ?? 0.5);
    if (t > 0.3) stops.push(`${p(t - 0.28)}% { opacity: 0.08; }`);
    stops.push(`${p(t)}% { opacity: ${r3(hi)}; }`);
  });
  stops.push('100% { opacity: 0.05; }');

  W('ov-bg.html', `<div class="bg__stage" lang="ja">
  <style>
    ${stage('bg', 'background: #0a0908;')}
    .bg__cam { position: absolute; inset: -6%; }
    ${ACT('.bg__cam')} { animation: bg__cam 17s ease-in-out infinite alternate; }
    @keyframes bg__cam {
      from { transform: scale(1.02) rotate(-0.4deg); }
      to { transform: scale(1.07) rotate(0.5deg); }
    }
    .bg__base { position: absolute; inset: 0;
      background: radial-gradient(120% 90% at 22% 8%, #17110b 0%, rgba(23,17,11,0) 55%),
                  linear-gradient(160deg, #0e0b08 0%, #0a0908 45%, #070808 100%); }
    /* 全画面 filter: blur() は CPU ラスタライザで極端に重い。使わない */
    .bg__pulse { position: absolute; inset: 0; mix-blend-mode: screen; opacity: 0;
      background: radial-gradient(85% 75% at 50% 55%, rgba(255,170,110,0.55) 0%, rgba(0,0,0,0) 75%); }
    ${ACT('.bg__pulse')} { animation: bg__pulse ${DUR}s linear 0s both; }
    @keyframes bg__pulse { ${stops.join(' ')} }
  </style>
  <div class="bg__cam"><div class="bg__base"></div><div class="bg__pulse"></div></div>
</div>
`);
  OV('bg', 'ov-bg.html', 0, DUR);
}

// =========================================================
// 2. 汎用ワンショット（節目に置く）
// =========================================================
W('ov-flash.html', `<div class="fl__stage" lang="ja">
  <style>
    ${stage('fl')}
    .fl__f { position: absolute; inset: 0; mix-blend-mode: screen; opacity: 0;
      background: radial-gradient(70% 60% at 50% 50%, rgba(255,244,230,0.9), rgba(0,0,0,0) 80%); }
    ${ACT('.fl__f')} { animation: fl__f 0.5s cubic-bezier(0.1, 0.8, 0.3, 1) both; }
    @keyframes fl__f { 0% { opacity: 0.95; } 100% { opacity: 0; } }
  </style>
  <div class="fl__f"></div>
</div>
`);

// =========================================================
// 3. 区間ごとの本体（sections のラベルを骨にする）
//    ここを案件ごとに書く。下は「ドロップ頭で大判タイポ」の最小例。
// =========================================================
{
  // 例: 最初の drop 区間の頭を拍番号で求める
  const dropStart = bm.sections.find((s) => s.label === 'drop')?.start_sec ?? B(32);
  const bn = beats.findIndex((t) => t >= dropStart - 1e-6);
  const start = B(bn), dur = r3(B(bn + 32) ? B(bn + 32) - start : DUR - start);

  W('ov-title.html', `<div class="ti__stage" lang="ja">
  <style>
    ${stage('ti', 'display: grid; place-items: center; text-align: center;')}
    .ti__t { color: ${TEXT}; font-size: ${TITLE_SIZE}px; font-weight: 800; letter-spacing: 0.06em;
      text-shadow: 0 6px 40px rgba(0,0,0,0.7); opacity: 0; }
    .ti__t em { color: ${ACCENT}; font-style: normal; }
    ${ACT('.ti__t')} { animation: ti__slam 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both; }
    @keyframes ti__slam { from { opacity: 0; transform: scale(1.3); } to { opacity: 1; transform: scale(1); } }
  </style>
  <div class="ti__t">ここに<em>見出し</em>。</div>
</div>
`);
  OV('title', 'ov-title.html', start, dur);
  S('impact-boom-big', start, -2);
}

// キメ（hit_points）にフラッシュを置く — 人が耳で決めた点なので確実に気持ちがいい
bm.hits.forEach((h, i) => OV(`flash-${i + 1}`, 'ov-flash.html', r3(h), 0.55));

// =========================================================
// 4. edit.json（末尾で 1 回だけ書き出す）
// =========================================================
{
  const missing = sfx.filter((s) => !fs.existsSync(path.join(ROOT, s.path)));
  if (missing.length) throw new Error('missing sfx: ' + JSON.stringify([...new Set(missing.map((m) => m.path))]));

  sfx.sort((a, b) => a.t - b.t);
  // 重なり順（z 順）= 配列順。背景 → B ロール → 3D → 図解/タイポ → フラッシュ
  const rank = (o) => o.id === 'bg' ? 0
    : o.id.startsWith('broll-') ? 1
    : o.id.startsWith('3d-') ? 2
    : o.id.startsWith('flash-') ? 4
    : 3;
  overlays.sort((a, b) => rank(a) - rank(b) || a.start - b.start);

  const edit = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30, look: { lut: 'cinematic', intensity: 0.3 } },
    sources: [{ id: 'base', path: 'assets/base-black.mp4', proxy: null }],
    cuts: [{ src: 'base', in: 0, out: DUR }],
    overlays,
    audio: {
      bgm: { path: `assets/bgm/${bm.track_id}.wav`, gain_db: 0, ducking: false, fadeIn: 0, fadeOut: 0.8 },
      sfx,
      narration: [],
    },
  };
  fs.writeFileSync(path.join(ROOT, 'edit.json'), JSON.stringify(edit, null, 2));
  console.log(`edit.json: overlays=${overlays.length} sfx=${sfx.length} dur=${DUR} bpm=${bpm}`);
}
