#!/usr/bin/env node
// 単発フレームプローブ — 本番と同じオーバーレイシートを作り、指定時刻を 1 枚だけ撮る。
// フルレンダー（数十分）を待たずに絵を確かめるための道具。
//
//   akari internal beat-sync-probe-frame <project> <秒> [<秒> ...] [--flatten <#rrggbb>]
//
// 出力: <project>/.akari/probe/t-<秒>.png（既定はアルファ保持）
//       --flatten を付けると指定色で合成した PNG も出す（目視用）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDER_CUT_SRC = resolve(HERE, '../../render-cut/src');
const { renderOverlaySheet } = await import(join(RENDER_CUT_SRC, 'rasterize.mjs'));
const { findChromePath } = await import(join(RENDER_CUT_SRC, 'render-cut.mjs'));

const args = process.argv.slice(2);
const flattenIndex = args.indexOf('--flatten');
const flatten = flattenIndex >= 0 ? (args[flattenIndex + 1] ?? '#000000') : null;
const positional = args.filter((a, i) => a !== '--flatten' && i !== flattenIndex + 1);
const projectRoot = resolve(positional[0] ?? '.');
const times = positional.slice(1).map(Number).filter((n) => Number.isFinite(n));
if (!times.length) {
  console.error('usage: probe-frame.mjs <project> <秒> [<秒> ...] [--flatten #rrggbb]');
  process.exit(1);
}

const edit = JSON.parse(readFileSync(join(projectRoot, 'edit.json'), 'utf8'));
const duration = (edit.cuts ?? []).reduce((m, c) => Math.max(m, c.out ?? 0), 0)
  || Number(edit.output?.duration) || Math.max(...times) + 1;

// production は loadOverlays() 済みの配列を渡す。html にはパスではなく「中身」を入れる。
const overlays = (edit.overlays ?? []).map((o) => ({
  ...o,
  html: readFileSync(resolve(projectRoot, o.html), 'utf8'),
}));

const outDir = join(projectRoot, '.akari', 'probe');
mkdirSync(outDir, { recursive: true });
const sheetPath = join(outDir, 'sheet.html');
writeFileSync(sheetPath, renderOverlaySheet({ overlays, edit, projectRoot, duration }));

const require = createRequire(join(RENDER_CUT_SRC, 'render-cut.mjs'));
const puppeteer = require('puppeteer-core');
const chromePath = await findChromePath();
if (!chromePath) {
  console.error('Chrome が見つかりません（render-cut と同じ探索を使用）。');
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  protocolTimeout: 600_000,
  // ↓ rasterize.mjs と同一にすること。--enable-unsafe-swiftshader が無いと 3D で固まる
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({
    width: edit.output?.width ?? 1920,
    height: edit.output?.height ?? 1080,
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (e) => console.error('[pageerror]', String(e).slice(0, 300)));
  await page.goto(`file://${sheetPath}`, { waitUntil: 'load', timeout: 180_000 });
  await page.evaluate(() => window.__akariReady);   // Promise を解決させる（production と同じ待ち方）

  for (const t of times) {
    await page.evaluate((s) => window.__akariSeek(s), t);
    const out = join(outDir, `t-${t}.png`);
    await page.screenshot({ path: out, omitBackground: true, timeout: 600_000 });
    console.log(out);
    if (flatten) {
      const flat = join(outDir, `t-${t}-on${flatten.replace('#', '')}.png`);
      execFileSync('ffmpeg', ['-v', 'error',
        '-f', 'lavfi', '-i', `color=${flatten}:s=${edit.output?.width ?? 1920}x${edit.output?.height ?? 1080}`,
        '-i', out, '-filter_complex', '[0][1]overlay=format=auto', '-frames:v', '1', '-y', flat]);
      console.log(flat);
    }
  }
} finally {
  await browser.close();
}
