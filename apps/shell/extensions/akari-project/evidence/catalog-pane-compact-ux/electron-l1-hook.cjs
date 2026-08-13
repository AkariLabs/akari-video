// Electron main process から webContents.debugger（CDP）で実機 DOM と PNG を観測する。
// localhost CDP が遮断された sandbox でも OS pipe 内で完結する再現スクリプト。
const { app } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const evidenceDir = process.env.AKARI_L1_EVIDENCE_DIR;
const log = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function record(step, value) {
  log.push({ step, value });
  console.log(`[catalog-pane-l1] ${step}`, JSON.stringify(value));
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
  const waitFor = async (expression, predicate, timeoutMs = 30000) => {
    const started = Date.now();
    let value;
    while (Date.now() - started < timeoutMs) {
      try {
        value = await evaluate(expression);
        if (predicate(value)) return value;
      } catch {
        // reload 中の execution context 切替は次の poll で回復する。
      }
      await sleep(400);
    }
    return value;
  };
  const waitForPreloadToClear = async () => {
    const cleared = await waitFor(
      `document.querySelector('.theia-preload') === null`,
      value => value === true,
      60000
    );
    assert(cleared === true, 'Theia preload overlay が DOM から消えませんでした', cleared);
  };
  const click = async selector => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const topmost = document.elementFromPoint(x, y);
      return {
        x,
        y,
        unobscured: topmost === element || element.contains(topmost),
        topmost: topmost ? {
          tag: topmost.tagName,
          id: topmost.id,
          className: typeof topmost.className === 'string' ? topmost.className : ''
        } : null
      };
    })()`);
    assert(point, 'click target not found', selector);
    assert(point.unobscured, 'click target is covered by another element', { selector, topmost: point.topmost });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
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
        if (root && root.getBoundingClientRect().width > 0) return root.getAttribute('data-akari-top-view');
        const icon = Array.from(document.querySelectorAll('.codicon-files')).find(el => el.getBoundingClientRect().width > 0);
        if (!icon) return null;
        const rect = icon.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (typeof state === 'string') return state;
      if (state?.x) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', clickCount: 1 });
      }
      await sleep(500);
    }
    throw new Error('素材パネルが表示されませんでした');
  };
  const resizeLeftPanel = async (targetWidth = 320) => {
    const geometry = await evaluate(`(() => {
      const panel = Array.from(document.querySelectorAll('[data-akari-top-view]'))
        .find(element => element.getBoundingClientRect().width > 0);
      const split = document.getElementById('theia-left-right-split-panel');
      const handles = split
        ? Array.from(split.children).filter(element => element.classList.contains('lm-SplitPanel-handle'))
        : [];
      const handle = handles
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return !element.classList.contains('lm-mod-hidden') && rect.height > 100;
        })
        .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left)[0];
      if (!panel || !handle) return null;
      const panelRect = panel.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      return {
        panelWidth: panelRect.width,
        x: handleRect.left + handleRect.width / 2,
        y: handleRect.top + handleRect.height / 2,
        handleHeight: handleRect.height
      };
    })()`);
    assert(geometry, '左パネルの split handle が見つかりません', geometry);

    const destinationX = geometry.x + targetWidth - geometry.panelWidth;
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: geometry.x, y: geometry.y, button: 'left', buttons: 1, clickCount: 1
    });
    for (let step = 1; step <= 5; step++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: geometry.x + (destinationX - geometry.x) * step / 5,
        y: geometry.y,
        button: 'left',
        buttons: 1
      });
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: destinationX, y: geometry.y, button: 'left', buttons: 0, clickCount: 1
    });

    const panelWidth = await waitFor(
      `(() => {
        const panel = Array.from(document.querySelectorAll('[data-akari-top-view]'))
          .find(element => element.getBoundingClientRect().width > 0);
        return panel?.getBoundingClientRect().width ?? 0;
      })()`,
      value => value >= targetWidth - 2 && value <= targetWidth + 2
    );
    assert(
      panelWidth >= targetWidth - 2 && panelWidth <= targetWidth + 2,
      '左パネルが目標幅へ到達しませんでした',
      { panelWidth, targetWidth }
    );
    record('left-panel-resized', { before: geometry.panelWidth, after: panelWidth, target: targetWidth });
    return panelWidth;
  };
  const openCatalog = async () => {
    await click('[data-akari-open-catalog]');
    return waitFor(
      `document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode') ?? null`,
      value => value === 'grid' || value === 'list'
    );
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await waitForPreloadToClear();
  await ensureMaterialsVisible();
  await resizeLeftPanel();
  await evaluate(`localStorage.removeItem('akari.catalog.viewMode')`);

  const initialMaterials = await evaluate(`(() => {
    const root = document.querySelector('[data-akari-top-view="materials"]');
    const first = root?.children[0];
    return {
      topView: root?.getAttribute('data-akari-top-view') ?? null,
      firstChildIsScrollBody: first?.style.overflow === 'auto',
      openCatalogPresent: !!root?.querySelector('[data-akari-open-catalog]')
    };
  })()`);
  record('materials-title-row-removed', initialMaterials);
  assert(initialMaterials.topView === 'materials' && initialMaterials.firstChildIsScrollBody, '素材面内タイトル行が残っています', initialMaterials);

  const initialMode = await openCatalog();
  assert(initialMode === 'grid', '新規状態の既定表示がカードではありません', initialMode);
  await waitFor(`Number(document.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count') ?? -1)`, value => value > 0);

  const compact = await evaluate(`(() => {
    const catalog = document.querySelector('[data-akari-top-view="catalog"]');
    const controls = catalog?.querySelector('[data-akari-catalog-controls]');
    const rows = controls ? Array.from(controls.children) : [];
    const categories = Array.from(catalog?.querySelectorAll('[data-akari-catalog-category]') ?? []).map(el => ({
      category: el.getAttribute('data-akari-catalog-category'),
      count: Number(el.getAttribute('data-akari-catalog-category-count')),
      text: el.textContent.trim()
    }));
    const panel = catalog?.getBoundingClientRect();
    const developer = catalog?.querySelector('[data-akari-developer-catalog-toggle]');
    return {
      panelWidth: panel?.width ?? 0,
      controlsHeight: controls?.getBoundingClientRect().height ?? 0,
      controlChildCount: rows.length,
      firstRowHook: rows[0]?.hasAttribute('data-akari-catalog-control-row') ?? false,
      secondRowIsTabs: rows[1]?.getAttribute('role') === 'tablist',
      backText: catalog?.querySelector('[data-akari-back-to-materials]')?.textContent.trim() ?? null,
      searchPresent: !!catalog?.querySelector('input[aria-label="カタログを検索"]'),
      togglePresent: !!catalog?.querySelector('[data-akari-catalog-view-toggle]'),
      accountHeaderPresent: !!catalog?.querySelector('[data-akari-catalog-account-header]'),
      resolverCountPresent: !!catalog?.querySelector('[data-akari-catalog-resolver-count]'),
      storeConnectionPresent: !!catalog?.querySelector('[data-akari-store-connection]'),
      storeConnectPresent: !!catalog?.querySelector('[data-akari-store-connect]'),
      storeDisconnectPresent: !!catalog?.querySelector('[data-akari-store-disconnect]'),
      categories,
      developerInsideControls: controls?.contains(developer) ?? null,
      retryInsideControls: controls?.contains(catalog?.querySelector('[data-akari-catalog-retry-inline]')) ?? null
    };
  })()`);
  record('compact-controls-and-fixed-categories', compact);
  assert(compact.controlChildCount === 2 && compact.firstRowHook && compact.secondRowIsTabs, '上部固定 chrome が2行構造ではありません', compact);
  assert(compact.backText === '← 素材' && compact.searchPresent && compact.togglePresent, 'compact control 行の要素が不足しています', compact);
  assert(
    !compact.accountHeaderPresent
      && !compact.resolverCountPresent
      && !compact.storeConnectionPresent
      && !compact.storeConnectPresent
      && !compact.storeDisconnectPresent,
    '削除対象のアカウント UI がカタログ面 DOM に残っています',
    compact
  );
  assert(!compact.developerInsideControls && !compact.retryInsideControls, 'スクロール項目が上部固定 controls 内に残っています', compact);
  const required = ['overlay', 'still', 'scene3d', 'audio', 'broll', 'font'];
  assert(required.every(category => compact.categories.some(chip => chip.category === category)), '固定6カテゴリが揃っていません', compact.categories);
  await screenshot('01-compact-controls-and-chips.png');

  const grid = await evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('[data-akari-catalog-item]')).filter(el => !el.hasAttribute('data-akari-catalog-list-row'));
    const visible = cards.filter(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
    const lefts = [...new Set(visible.slice(0, 18).map(el => Math.round(el.getBoundingClientRect().left)))];
    return { visibleCards: visible.length, distinctColumns: lefts.length, lefts, widths: visible.slice(0, 6).map(el => Math.round(el.getBoundingClientRect().width)) };
  })()`);
  record('grid-density', grid);
  assert(compact.panelWidth >= 280 && compact.panelWidth <= 400, '検証時パネル幅が320px目安から外れています', compact.panelWidth);
  assert(grid.distinctColumns >= 3, 'カードが3列以上並んでいません', grid);
  await screenshot('02-grid-three-columns.png');

  await click('[data-akari-catalog-category="overlay"]');
  const zeroCategory = await waitFor(`(() => {
    const empty = document.querySelector('[data-akari-catalog-filter-empty]');
    return empty ? { kind: empty.getAttribute('data-akari-catalog-filter-empty'), text: empty.textContent.trim() } : null;
  })()`, value => value?.kind === 'category-empty');
  record('zero-category-empty-state', zeroCategory);
  assert(zeroCategory?.text === 'この種類の素材はまだカタログにありません', '0件カテゴリ専用文言が違います', zeroCategory);
  await screenshot('03-zero-category.png');

  await click('[data-akari-catalog-category="all"]');
  const propagation = await evaluate(`(() => {
    const toggle = document.querySelector('[data-akari-catalog-view-toggle]');
    if (!toggle) throw new Error('表示切替ボタンが見つかりません');

    let reactRoot = null;
    for (let node = toggle; node; node = node.parentElement) {
      if (Object.getOwnPropertyNames(node).some(key => key.startsWith('__reactContainer$'))) {
        reactRoot = node;
        break;
      }
    }
    if (!reactRoot) throw new Error('表示切替ボタンの祖先に React root container が見つかりません');

    const propagationTarget = reactRoot.parentElement;
    if (!propagationTarget) throw new Error('React root container の親要素が見つかりません');

    let clickCount = 0;
    let afterToggle;
    let afterChip;
    const countClick = () => clickCount++;
    propagationTarget.addEventListener('click', countClick);
    try {
      toggle.click();
      afterToggle = clickCount;
      const positiveChip = document.querySelector('[data-akari-catalog-category="overlay"]');
      if (!positiveChip) throw new Error('伝播の陽性対照に使うカテゴリチップが見つかりません');
      positiveChip.click();
      afterChip = clickCount;
    } finally {
      propagationTarget.removeEventListener('click', countClick);
      const allChip = document.querySelector('[data-akari-catalog-category="all"]');
      if (!allChip) throw new Error('検査後に all カテゴリへ戻せません');
      allChip.click();
    }
    return { afterToggle, afterChip };
  })()`);
  record('view-toggle-stop-propagation', propagation);
  assert(propagation.afterToggle === 0, '表示切替クリックが React root container の外へ伝播しています', propagation);
  assert(propagation.afterChip === 1, 'カテゴリチップの伝播を観測できず、陽性対照が成立していません', propagation);
  await sleep(500);

  const list = await evaluate(`(() => {
    const mode = document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode');
    const rows = Array.from(document.querySelectorAll('[data-akari-catalog-list-row]'));
    const first = rows[0];
    const title = first?.children[1]?.getBoundingClientRect();
    const actions = first?.children[2]?.getBoundingClientRect();
    return {
      mode,
      rowCount: rows.length,
      packCount: document.querySelectorAll('[data-akari-catalog-pack]').length,
      packRows: document.querySelectorAll('[data-akari-catalog-pack] [data-akari-catalog-list-row]').length,
      actionAtRight: !!title && !!actions && actions.left > title.left,
      stored: localStorage.getItem('akari.catalog.viewMode')
    };
  })()`);
  record('list-view', list);
  assert(list.mode === 'list' && list.rowCount > 0 && list.actionAtRight, '横長リスト表示が成立していません', list);
  assert(list.packCount > 0 && list.packRows > 0, 'リスト表示でパック棚が維持されていません', list);
  assert(list.stored === 'list', '表示モードが localStorage に保存されていません', list);

  const audioPreview = await evaluate(`(() => {
    const catalog = document.querySelector('[data-akari-top-view="catalog"]');
    const toggles = Array.from(catalog?.querySelectorAll('[data-akari-catalog-audio-toggle]') ?? []);
    return {
      toggleCount: toggles.length,
      allInsideListRows: toggles.every(toggle => !!toggle.closest('[data-akari-catalog-list-row]')),
      limitation: toggles.length === 0 ? 'resolver-failure catalog has no mediaUrl-backed audio items' : null
    };
  })()`);
  record('audio-preview-list-row-observation', audioPreview);
  assert(audioPreview.toggleCount === 0 || audioPreview.allInsideListRows, 'audio 試聴トグルがリスト行外にあります', audioPreview);
  await screenshot('04-list-view.png');

  const retry = await evaluate(`(() => {
    const button = document.querySelector('[data-akari-catalog-retry-inline]');
    return button ? { text: button.parentElement.textContent.trim(), visible: button.getBoundingClientRect().height > 0 } : null;
  })()`);
  record('resolver-retry-inline', retry);
  assert(retry?.visible && retry.text.includes('アカウント素材の取得に失敗') && retry.text.includes('再試行'), 'resolver 失敗時の再試行行がありません', retry);
  await screenshot('05-resolver-retry-row.png');

  const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await reloaded;
  await waitForPreloadToClear();
  await ensureMaterialsVisible();
  await openCatalog();
  const persisted = await waitFor(`(() => ({
    mode: document.querySelector('[data-akari-catalog-view-mode]')?.getAttribute('data-akari-catalog-view-mode') ?? null,
    rows: document.querySelectorAll('[data-akari-catalog-list-row]').length,
    stored: localStorage.getItem('akari.catalog.viewMode')
  }))()`, value => value.mode === 'list' && value.rows > 0);
  record('list-persisted-after-reload', persisted);
  assert(persisted.mode === 'list' && persisted.stored === 'list', 'リロード後にリスト表示が復元されません', persisted);
  await screenshot('06-list-persisted-after-reload.png');

  await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify(log, null, 2));
  cdp.detach();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => {
      console.log('[catalog-pane-l1] L1_OK');
      app.exit(0);
    }).catch(async error => {
      console.error('[catalog-pane-l1] L1_FAILED', error);
      try {
        await writeFile(path.join(evidenceDir, 'run-log.json'), JSON.stringify([...log, { step: 'failure', value: String(error.stack ?? error) }], null, 2));
      } catch { /* best effort */ }
      app.exit(1);
    });
  });
});
