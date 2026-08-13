const { app } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const evidenceDir = process.env.AKARI_L1_EVIDENCE_DIR;
const log = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function record(step, value) {
  log.push({ step, value });
  console.log(`[catalog-preset-l1] ${step}`, JSON.stringify(value));
}

function assert(condition, message, value) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(value)}`);
}

async function run(win) {
  const cdp = win.webContents.debugger;
  cdp.attach('1.3');
  const send = (method, params = {}) => cdp.sendCommand(method, params);
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`Runtime.evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
    return result.result.value;
  };
  const waitFor = async (expression, predicate, timeoutMs = 60000) => {
    const started = Date.now();
    let value;
    while (Date.now() - started < timeoutMs) {
      try {
        value = await evaluate(expression);
        if (predicate(value)) return value;
      } catch {
        // reload / startup 中の execution context 切替は次の poll で回復する。
      }
      await sleep(400);
    }
    return value;
  };
  const click = async selector => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert(point, 'click target not found', selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await sleep(500);
  };
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidenceDir, name), Buffer.from(data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  const preloadCleared = await waitFor(`document.querySelector('.theia-preload') === null`, value => value === true);
  assert(preloadCleared, 'Theia preload overlay が消えませんでした', preloadCleared);

  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await evaluate(`(() => {
      const root = document.querySelector('[data-akari-top-view]');
      if (root && root.getBoundingClientRect().width > 0) return 'ready';
      const icon = Array.from(document.querySelectorAll('.codicon-files')).find(el => el.getBoundingClientRect().width > 0);
      if (!icon) return null;
      const rect = icon.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (state === 'ready') break;
    if (state?.x) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', clickCount: 1 });
    }
    await sleep(500);
  }

  await evaluate(`localStorage.removeItem('akari.catalog.viewMode')`);
  await click('[data-akari-open-catalog]');
  const chips = await waitFor(`(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-akari-catalog-category]')).map(el => [el.getAttribute('data-akari-catalog-category'), Number(el.getAttribute('data-akari-catalog-category-count'))])))()`, value => value?.['preset:telop'] === 36 && value?.['preset:lut'] === 10);
  record('category-chips', chips);
  assert(chips.all === 62, 'すべてチップへプリセットが混入しています', chips);

  await click('[data-akari-catalog-category="preset:telop"]');
  const telop = await waitFor(`(() => {
    const items = Array.from(document.querySelectorAll('[data-akari-catalog-preset-item]'));
    return {
      count: items.length,
      buttons: items.reduce((sum, item) => sum + item.querySelectorAll('button').length, 0),
      assetItems: document.querySelectorAll('[data-akari-catalog-item]').length,
      packs: document.querySelectorAll('[data-akari-catalog-pack]').length,
      mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode')
    };
  })()`, value => value?.count === 36);
  record('telop-grid-read-only', telop);
  assert(telop.buttons === 0 && telop.assetItems === 0 && telop.packs === 0 && telop.mode === 'grid', 'テロップ棚が独立した読み取り専用グリッドではありません', telop);
  await screenshot('01-telop-36-read-only.png');

  await click('[data-akari-catalog-view-toggle]');
  const telopList = await waitFor(`(() => ({
    mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode'),
    rows: document.querySelectorAll('[data-akari-catalog-preset-list-row]').length,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length
  }))()`, value => value?.mode === 'list' && value?.rows === 36);
  record('telop-list-read-only', telopList);
  assert(telopList.buttons === 0, 'リスト表示にアクションボタンがあります', telopList);

  await click('[data-akari-catalog-category="preset:lut"]');
  const lut = await waitFor(`(() => ({
    count: document.querySelectorAll('[data-akari-catalog-preset-item]').length,
    rows: document.querySelectorAll('[data-akari-catalog-preset-list-row]').length,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length,
    descriptions: Array.from(document.querySelectorAll('[data-akari-catalog-preset-list-row]')).filter(row => row.textContent.trim().length > 0).length
  }))()`, value => value?.count === 10);
  record('lut-list-read-only', lut);
  assert(lut.rows === 10 && lut.buttons === 0 && lut.descriptions === 10, 'LUT の読み取り専用リストが不完全です', lut);
  await screenshot('02-lut-list.png');

  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="カタログを検索"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'night-neon');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const filtered = await waitFor(`(() => ({
    count: document.querySelectorAll('[data-akari-catalog-preset-item]').length,
    text: document.querySelector('[data-akari-catalog-preset-item]')?.textContent.trim() ?? null,
    buttons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length
  }))()`, value => value?.count === 1);
  record('preset-search-filter', filtered);
  assert(filtered.text?.includes('ナイトネオン') && filtered.buttons === 0, 'id 検索結果が正しくありません', filtered);
  await screenshot('03-preset-search-filter.png');

  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="カタログを検索"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'no-such-preset');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const empty = await waitFor(`document.querySelector('[data-akari-catalog-preset-empty]')?.textContent.trim() ?? null`, value => value === '条件に一致するプリセットがありません');
  record('preset-search-empty', empty);
  assert(empty === '条件に一致するプリセットがありません', 'プリセット専用の0件文言が違います', empty);

  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify(log, null, 2));
  cdp.detach();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => {
      console.log('[catalog-preset-l1] L1_OK');
      app.exit(0);
    }).catch(async error => {
      console.error('[catalog-preset-l1] L1_FAILED', error);
      try {
        await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify([...log, { step: 'failure', value: String(error.stack ?? error) }], null, 2));
      } catch { /* best effort */ }
      app.exit(1);
    });
  });
});
