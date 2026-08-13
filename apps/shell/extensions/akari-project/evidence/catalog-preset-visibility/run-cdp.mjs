import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , url, chromePath, evidenceDir] = process.argv;
const log = [];
const record = (step, value) => {
  log.push({ step, value });
  console.log(`[catalog-preset-cdp] ${step}`, JSON.stringify(value));
};
const assert = (condition, message, value) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(value)}`);
};

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 850, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.theia-preload') === null, { timeout: 60000 });

  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await page.$('[data-akari-top-view]');
    if (ready) break;
    const icon = await page.$('.codicon-files');
    if (icon) await icon.click();
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  await page.evaluate(() => localStorage.removeItem('akari.catalog.viewMode'));
  await page.click('[data-akari-open-catalog]');
  await page.waitForFunction(() => {
    const telop = document.querySelector('[data-akari-catalog-category="preset:telop"]');
    const lut = document.querySelector('[data-akari-catalog-category="preset:lut"]');
    return telop?.getAttribute('data-akari-catalog-category-count') === '36'
      && lut?.getAttribute('data-akari-catalog-category-count') === '10';
  }, { timeout: 60000 });

  const handle = await page.evaluate(() => {
    const panel = document.querySelector('[data-akari-top-view]');
    const split = document.getElementById('theia-left-right-split-panel');
    const candidate = Array.from(split?.children ?? []).find(element => {
      const rect = element.getBoundingClientRect();
      return element.classList.contains('lm-SplitPanel-handle') && rect.height > 100 && !element.classList.contains('lm-mod-hidden');
    });
    if (!panel || !candidate) return null;
    const panelRect = panel.getBoundingClientRect();
    const rect = candidate.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, delta: 360 - panelRect.width };
  });
  if (handle) {
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.delta, handle.y, { steps: 5 });
    await page.mouse.up();
  }

  const chips = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-akari-catalog-category]')).map(el => [
    el.getAttribute('data-akari-catalog-category'),
    Number(el.getAttribute('data-akari-catalog-category-count'))
  ])));
  record('category-chips', chips);
  assert(chips.all === 62 && chips['preset:telop'] === 36 && chips['preset:lut'] === 10, 'カテゴリ件数が違います', chips);

  await page.click('[data-akari-catalog-category="preset:telop"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-akari-catalog-preset-item]').length === 36);
  const telop = await page.evaluate(() => ({
    count: document.querySelectorAll('[data-akari-catalog-preset-item]').length,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length,
    assetItems: document.querySelectorAll('[data-akari-catalog-item]').length,
    packs: document.querySelectorAll('[data-akari-catalog-pack]').length,
    mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode')
  }));
  record('telop-grid-read-only', telop);
  assert(telop.count === 36 && telop.buttons === 0 && telop.assetItems === 0 && telop.packs === 0 && telop.mode === 'grid', 'テロップ棚が読み取り専用グリッドではありません', telop);
  await page.screenshot({ path: path.join(evidenceDir, '01-telop-36-read-only.png') });

  await page.click('[data-akari-catalog-view-toggle]');
  await page.waitForFunction(() => document.querySelectorAll('[data-akari-catalog-preset-list-row]').length === 36);
  const telopList = await page.evaluate(() => ({
    mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode'),
    rows: document.querySelectorAll('[data-akari-catalog-preset-list-row]').length,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length
  }));
  record('telop-list-read-only', telopList);
  assert(telopList.mode === 'list' && telopList.rows === 36 && telopList.buttons === 0, 'テロップのリスト表示が不完全です', telopList);

  await page.click('[data-akari-catalog-category="preset:lut"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-akari-catalog-preset-item]').length === 10);
  const lut = await page.evaluate(() => ({
    count: document.querySelectorAll('[data-akari-catalog-preset-item]').length,
    rows: document.querySelectorAll('[data-akari-catalog-preset-list-row]').length,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length,
    titled: Array.from(document.querySelectorAll('[data-akari-catalog-preset-item]')).filter(item => item.getAttribute('title')?.includes('\n')).length
  }));
  record('lut-list-read-only', lut);
  assert(lut.count === 10 && lut.rows === 10 && lut.buttons === 0 && lut.titled === 10, 'LUT の説明付きリストが不完全です', lut);
  await page.screenshot({ path: path.join(evidenceDir, '02-lut-list.png') });

  const input = await page.$('input[aria-label="カタログを検索"]');
  await input.click({ clickCount: 3 });
  await input.type('night-neon');
  await page.waitForFunction(() => document.querySelectorAll('[data-akari-catalog-preset-item]').length === 1);
  const filtered = await page.evaluate(() => ({
    count: document.querySelectorAll('[data-akari-catalog-preset-item]').length,
    text: document.querySelector('[data-akari-catalog-preset-item]')?.textContent.trim() ?? null,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length
  }));
  record('preset-search-filter', filtered);
  assert(filtered.text?.includes('ナイトネオン') && filtered.buttons === 0, 'プリセット検索結果が違います', filtered);
  await page.screenshot({ path: path.join(evidenceDir, '03-preset-search-filter.png') });

  await input.click({ clickCount: 3 });
  await input.type('no-such-preset');
  await page.waitForFunction(() => document.querySelector('[data-akari-catalog-preset-empty]'));
  const empty = await page.$eval('[data-akari-catalog-preset-empty]', element => element.textContent.trim());
  record('preset-search-empty', empty);
  assert(empty === '条件に一致するプリセットがありません', 'プリセット専用の0件文言が違います', empty);

  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify(log, null, 2));
  console.log('[catalog-preset-cdp] L1_OK');
} catch (error) {
  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify([...log, { step: 'failure', value: String(error.stack ?? error) }], null, 2));
  throw error;
} finally {
  await browser.close();
}
