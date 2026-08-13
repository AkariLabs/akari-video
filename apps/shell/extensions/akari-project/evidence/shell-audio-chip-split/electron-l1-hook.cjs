// Production Electron is observed through webContents.debugger (CDP), matching the existing catalog evidence harnesses.
const { app } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const evidenceDir = process.env.AKARI_L1_EVIDENCE_DIR;
const expectedBgmIds = JSON.parse(process.env.AKARI_L1_EXPECTED_BGM_IDS ?? '[]');
const expectedSfxIds = JSON.parse(process.env.AKARI_L1_EXPECTED_SFX_IDS ?? '[]');
const log = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function record(step, value) {
  log.push({ step, value });
  console.log(`[shell-audio-chip-split-l1] ${step}`, JSON.stringify(value));
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
        // Startup can replace the execution context. The next poll recovers.
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
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const topmost = document.elementFromPoint(x, y);
      return { x, y, unobscured: topmost === element || element.contains(topmost) };
    })()`);
    assert(point?.unobscured, 'click target is missing or covered', { selector, point });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await sleep(500);
  };
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidenceDir, name), Buffer.from(data, 'base64'));
  };
  const ensureMaterialsVisible = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const state = await evaluate(`(() => {
        const root = document.querySelector('[data-akari-top-view]');
        if (root && root.getBoundingClientRect().width > 0) return 'ready';
        const icon = Array.from(document.querySelectorAll('.codicon-files')).find(element => element.getBoundingClientRect().width > 0);
        if (!icon) return null;
        const rect = icon.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (state === 'ready') return;
      if (state?.x) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', clickCount: 1 });
      }
      await sleep(500);
    }
    throw new Error('素材パネルが表示されませんでした');
  };
  const resizeLeftPanel = async targetWidth => {
    const geometry = await evaluate(`(() => {
      const panel = Array.from(document.querySelectorAll('[data-akari-top-view]')).find(element => element.getBoundingClientRect().width > 0);
      const split = document.getElementById('theia-left-right-split-panel');
      const handle = Array.from(split?.children ?? [])
        .filter(element => element.classList.contains('lm-SplitPanel-handle'))
        .filter(element => !element.classList.contains('lm-mod-hidden') && element.getBoundingClientRect().height > 100)
        .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left)[0];
      if (!panel || !handle) return null;
      const panelRect = panel.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      return { panelWidth: panelRect.width, x: handleRect.left + handleRect.width / 2, y: handleRect.top + handleRect.height / 2 };
    })()`);
    assert(geometry, 'left split handle not found', geometry);
    const destinationX = geometry.x + targetWidth - geometry.panelWidth;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geometry.x, y: geometry.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: geometry.x + (destinationX - geometry.x) * step / 5,
        y: geometry.y, button: 'left', buttons: 1
      });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: destinationX, y: geometry.y, button: 'left', buttons: 0, clickCount: 1 });
    const width = await waitFor(
      `Array.from(document.querySelectorAll('[data-akari-top-view]')).find(element => element.getBoundingClientRect().width > 0)?.getBoundingClientRect().width ?? 0`,
      value => Math.abs(value - targetWidth) <= 2
    );
    assert(Math.abs(width - targetWidth) <= 2, 'left panel did not reach target width', { width, targetWidth });
    record('left-panel-resized', { before: geometry.panelWidth, after: width, target: targetWidth });
  };
  const visibleItemIds = async () => evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-akari-catalog-item]')).map(element => element.getAttribute('data-akari-catalog-item').replace(/^audio\\//, '')))).sort()`);
  const selectAndMeasure = async (category, expectedIds, screenshotName) => {
    await click(`[data-akari-catalog-category="${category}"]`);
    const selection = await waitFor(`(() => {
      const chip = document.querySelector('[data-akari-catalog-category="${category}"]');
      const ids = Array.from(new Set(Array.from(document.querySelectorAll('[data-akari-catalog-item]')).map(element => element.getAttribute('data-akari-catalog-item').replace(/^audio\\//, '')))).sort();
      return { active: chip?.getAttribute('aria-selected'), ids };
    })()`, value => value?.active === 'true' && value.ids.length === expectedIds.length);
    const actualIds = await visibleItemIds();
    assert(JSON.stringify(actualIds) === JSON.stringify([...expectedIds].sort()), 'selected chip contains the wrong items', { category, actualIds, expectedIds });
    const measurement = { category, count: actualIds.length, ids: actualIds };
    record(`${category}-selection`, measurement);
    await screenshot(screenshotName);
    return measurement;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  const preloadCleared = await waitFor(`document.querySelector('.theia-preload') === null`, value => value === true);
  assert(preloadCleared, 'Theia preload overlay did not clear', preloadCleared);
  await ensureMaterialsVisible();
  await resizeLeftPanel(420);
  await evaluate(`localStorage.removeItem('akari.catalog.viewMode')`);
  await click('[data-akari-open-catalog]');

  const chipState = await waitFor(`(() => ({
    total: Number(document.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count') ?? -1),
    chips: Array.from(document.querySelectorAll('[data-akari-catalog-category]')).map(element => ({
      category: element.getAttribute('data-akari-catalog-category'),
      count: Number(element.getAttribute('data-akari-catalog-category-count')),
      text: element.textContent.trim()
    }))
  }))()`, value => value?.chips.some(chip => chip.category === 'audio:bgm' && chip.count === expectedBgmIds.length)
    && value.chips.some(chip => chip.category === 'audio:sfx' && chip.count === expectedSfxIds.length));
  const expectedOrder = ['all', 'overlay', 'still', 'scene3d', 'audio:bgm', 'audio:sfx', 'broll', 'font', 'preset:telop', 'preset:lut'];
  assert(JSON.stringify(chipState.chips.map(chip => chip.category)) === JSON.stringify(expectedOrder), 'catalog chip order is incorrect', chipState.chips);
  assert(!chipState.chips.some(chip => chip.category === 'audio' || /^\u97f3\u58f0(?:\s|$)/.test(chip.text)), 'legacy audio chip remains', chipState.chips);
  const bgmChip = chipState.chips.find(chip => chip.category === 'audio:bgm');
  const sfxChip = chipState.chips.find(chip => chip.category === 'audio:sfx');
  const counts = {
    all: chipState.total,
    bgm: bgmChip.count,
    sfx: sfxChip.count,
    audioTotal: bgmChip.count + sfxChip.count
  };
  assert(counts.bgm === 10 && counts.sfx === 17 && counts.audioTotal === 27, 'DOM chip counts do not match the local 27 audio entries', counts);
  record('dom-chip-counts', counts);
  record('chip-order-and-labels', chipState.chips);

  await selectAndMeasure('audio:bgm', expectedBgmIds, '01-bgm-chip-selected.png');
  await selectAndMeasure('audio:sfx', expectedSfxIds, '02-sfx-chip-selected.png');

  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify(log, null, 2));
  cdp.detach();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => {
      console.log('[shell-audio-chip-split-l1] L1_OK');
      app.exit(0);
    }).catch(async error => {
      console.error('[shell-audio-chip-split-l1] L1_FAILED', error);
      try {
        await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify([...log, { step: 'failure', value: String(error.stack ?? error) }], null, 2));
      } catch { /* best effort */ }
      app.exit(1);
    });
  });
});
