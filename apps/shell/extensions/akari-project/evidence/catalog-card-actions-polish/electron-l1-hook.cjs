const { app } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const evidenceDir = process.env.AKARI_L1_EVIDENCE_DIR;
const log = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function record(step, value) {
  log.push({ step, value });
  console.log(`[catalog-card-actions-l1] ${step}`, JSON.stringify(value));
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
        // Startup and reload replace the execution context; the next poll recovers.
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
        type: 'mouseMoved',
        x: geometry.x + (destinationX - geometry.x) * step / 5,
        y: geometry.y,
        button: 'left',
        buttons: 1
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  const preloadCleared = await waitFor(`document.querySelector('.theia-preload') === null`, value => value === true);
  assert(preloadCleared, 'Theia preload overlay did not clear', preloadCleared);
  await ensureMaterialsVisible();
  await resizeLeftPanel(320);
  await evaluate(`localStorage.removeItem('akari.catalog.viewMode')`);
  await click('[data-akari-open-catalog]');

  const itemCount = await waitFor(
    `Number(document.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count') ?? -1)`,
    value => value === 4
  );
  assert(itemCount === 4, 'HTTP resolver 3 items + local item were not loaded', itemCount);

  const grid = await evaluate(`(() => {
    const round = value => Math.round(value * 100) / 100;
    const measure = card => {
      const cardRect = card.getBoundingClientRect();
      const actions = card.querySelector('[data-akari-catalog-actions]');
      const actionRect = actions.getBoundingClientRect();
      const buttons = Array.from(actions.querySelectorAll('[data-akari-catalog-action]')).map(button => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          action: button.getAttribute('data-akari-catalog-action'),
          text: button.textContent.trim(),
          title: button.title,
          left: round(rect.left),
          right: round(rect.right),
          insideLeft: rect.left >= cardRect.left - 0.01,
          insideRight: rect.right <= cardRect.right + 0.01,
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
          scrollWidth: button.scrollWidth,
          clientWidth: button.clientWidth
        };
      });
      return {
        key: card.getAttribute('data-akari-catalog-item'),
        state: card.getAttribute('data-akari-catalog-item-state'),
        card: { left: round(cardRect.left), right: round(cardRect.right), width: round(cardRect.width) },
        actions: {
          left: round(actionRect.left),
          right: round(actionRect.right),
          leftMargin: round(actionRect.left - cardRect.left),
          rightMargin: round(cardRect.right - actionRect.right),
          marginDelta: round(Math.abs((actionRect.left - cardRect.left) - (cardRect.right - actionRect.right)))
        },
        buttons
      };
    };
    const locked = document.querySelector('[data-akari-catalog-item="still/paid-card-2980"]');
    const available = document.querySelector('[data-akari-catalog-item="still/free-card"]');
    const local = Array.from(document.querySelectorAll('[data-akari-catalog-item]')).find(card =>
      !card.hasAttribute('data-akari-catalog-list-row')
      && card.querySelector('[data-akari-catalog-action="import"]')
      && card.querySelector('[data-akari-catalog-action="ask"]'));
    return { mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode'), locked: measure(locked), available: measure(available), local: measure(local) };
  })()`);
  record('grid-card-action-measurements', grid);
  assert(grid.mode === 'grid', 'initial catalog mode is not grid', grid.mode);
  for (const sample of [grid.locked, grid.available, grid.local]) {
    assert(sample.card.width >= 89 && sample.card.width <= 93, 'card width is not approximately 91px', sample);
    assert(sample.actions.marginDelta <= 2, 'action row is not horizontally centered', sample);
    assert(sample.buttons.every(button => button.insideLeft && button.insideRight), 'an action button overflows its card', sample);
    assert(sample.buttons.every(button => button.whiteSpace === 'nowrap' && button.textOverflow === 'ellipsis'), 'button overflow styles are missing', sample);
  }
  assert(grid.locked.state === 'locked' && grid.locked.buttons[0].text === '¥2,980', 'locked card label is not compact', grid.locked);
  assert(grid.locked.buttons[0].title.includes('¥2,980 で購入 — ストアを開く'), 'locked card title lost the full action description', grid.locked);
  assert(grid.locked.buttons[0].scrollWidth <= grid.locked.buttons[0].clientWidth, 'locked price does not fit on one line', grid.locked);
  assert(grid.available.state === 'available' && grid.available.buttons[0].text === '使う', 'available card action is incorrect', grid.available);
  assert(grid.local.buttons.map(button => button.text).join(' + ') === '取り込む + 頼む', 'local card actions are incorrect', grid.local);
  await screenshot('01-grid-locked-available-local.png');

  await click('[data-akari-catalog-view-toggle]');
  const list = await waitFor(`(() => {
    const row = document.querySelector('[data-akari-catalog-item="still/paid-card-2980"][data-akari-catalog-list-row]');
    const button = row?.querySelector('[data-akari-catalog-action="purchase"]');
    if (!row || !button) return null;
    const rowRect = row.getBoundingClientRect();
    const titleRect = row.children[1].getBoundingClientRect();
    const actionShellRect = row.children[2].getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode'),
      text: button.textContent.trim(),
      title: button.title,
      actionAtRight: actionShellRect.left > titleRect.left,
      buttonInsideRow: buttonRect.right <= rowRect.right + 0.01,
      rowRight: rowRect.right,
      buttonRight: buttonRect.right
    };
  })()`, value => value?.mode === 'list');
  record('list-purchase-action', list);
  assert(list.text === '¥2,980 で購入', 'list purchase label is incorrect', list);
  assert(list.title.includes('¥2,980 で購入 — ストアを開く'), 'list title lost the full action description', list);
  assert(list.actionAtRight && list.buttonInsideRow, 'list action is not right-aligned inside the row', list);
  await screenshot('02-list-purchase-action.png');

  await click('[data-akari-catalog-category="preset:telop"]');
  const presets = await waitFor(`(() => ({
    count: document.querySelectorAll('[data-akari-catalog-preset-item]').length,
    actionButtons: document.querySelectorAll('[data-akari-catalog-preset-item] button').length
  }))()`, value => value?.count > 0);
  record('preset-read-only-regression', presets);
  assert(presets.actionButtons === 0, 'read-only preset cards gained action buttons', presets);
  await screenshot('03-preset-read-only.png');

  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify(log, null, 2));
  cdp.detach();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => {
      console.log('[catalog-card-actions-l1] L1_OK');
      app.exit(0);
    }).catch(async error => {
      console.error('[catalog-card-actions-l1] L1_FAILED', error);
      try {
        await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify([...log, { step: 'failure', value: String(error.stack ?? error) }], null, 2));
      } catch { /* best effort */ }
      app.exit(1);
    });
  });
});
