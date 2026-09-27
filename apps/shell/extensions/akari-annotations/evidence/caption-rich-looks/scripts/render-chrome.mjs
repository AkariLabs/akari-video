import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../../../../../');
const evidence = resolve(here, '..');
const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error('CHROME_PATH is required');
const { generateCaptionOverlays } = await import(join(repo, 'packages/render-cut/src/captions.mjs'));
const captions = JSON.parse(readFileSync(join(evidence, 'fixtures/captions.json'), 'utf8')).captions;
const output = { width: 1280, height: 720 };
const overlays = generateCaptionOverlays(captions, [], { output });
const work = mkdtempSync(join(tmpdir(), 'caption-rich-looks-chrome-'));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: work,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-background-networking'] });
  const page = await browser.newPage();
  await page.setViewport({ width: output.width, height: output.height, deviceScaleFactor: 1 });
  const images = [];
  for (const [index, caption] of captions.entries()) {
    const overlay = overlays.find(item => item.generatedFrom === caption.id);
    if (!overlay) throw new Error(`overlay missing for ${caption.id}`);
    const vars = Object.entries(overlay.vars).map(([name, value]) => `${name}:${value};`).join('');
    await page.setContent(`<html><head><meta charset="utf-8"><style>*{box-sizing:border-box;animation:none!important;transition:none!important}html,body{margin:0;width:100%;height:100%;background:#172033}#stage{position:relative;width:1280px;height:720px;overflow:hidden;background:linear-gradient(145deg,#20283c,#121827);${vars}}</style></head><body><div id="stage">${overlay.html}</div></body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const file = join(evidence, `chrome-${index + 1}-${caption.id}.png`);
    await page.screenshot({ path: file });
    images.push({ label: caption.text, data: readFileSync(file).toString('base64') });
  }
  const extras = [
    { name: 'styled-gradient', caption: { ...captions[3], id: 'c-0101', start: 0, end: 2,
      text: '光る字幕', style: 'karaoke', words: [
        { start: 0, end: 1, text: '光る' }, { start: 1, end: 2, text: '字幕' }
      ] } },
    { name: 'gradient-background', caption: { ...captions[2], id: 'c-0102', start: 0, end: 2,
      text_style: { ...captions[2].text_style, background: {
        color: '#000000', opacity: .65, padding_px: 8, radius_px: 10
      } } } }
  ];
  for (const extra of extras) {
    const overlay = generateCaptionOverlays([extra.caption], [], { output })[0];
    const vars = Object.entries(overlay.vars).map(([name, value]) => `${name}:${value};`).join('');
    await page.setContent(`<html><head><meta charset="utf-8"><style>*{box-sizing:border-box;animation:none!important;transition:none!important}html,body{margin:0;width:100%;height:100%;background:#172033}#stage{position:relative;width:1280px;height:720px;overflow:hidden;background:linear-gradient(145deg,#20283c,#121827);${vars}}</style></head><body><div id="stage">${overlay.html}</div></body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(evidence, `chrome-${extra.name}.png`) });
  }
  await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 1 });
  await page.setContent(`<html><head><meta charset="utf-8"><style>body{margin:0;background:#101827;color:white;font:20px sans-serif;display:grid;grid-template-columns:repeat(2,480px);gap:12px;padding:10px}.card{background:#273449;padding:6px}.card img{width:468px;height:263px;object-fit:contain}.label{padding:3px 6px}</style></head><body>${images.map(item => `<div class="card"><div class="label">${item.label}</div><img src="data:image/png;base64,${item.data}"></div>`).join('')}</body></html>`, { waitUntil: 'load' });
  await page.screenshot({ path: join(evidence, 'chrome-contact.png'), fullPage: true });
  console.log(`captured ${images.length} looks`);
} finally {
  if (browser) await browser.close();
  rmSync(work, { recursive: true, force: true });
}
