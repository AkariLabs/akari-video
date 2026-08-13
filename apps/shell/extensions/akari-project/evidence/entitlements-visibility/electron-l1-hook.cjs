const { app } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const evidenceDir = process.env.AKARI_L1_EVIDENCE_DIR;
const scenario = process.env.AKARI_L1_ENTITLEMENTS_SCENARIO;
const log = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function record(step, value) {
  log.push({ step, value });
  console.log(`[entitlements-visibility-l1] ${step}`, JSON.stringify(value));
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
        // Startup and view changes replace execution contexts; the next poll recovers.
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
  const scrollFullyIntoView = async (selector, label) => {
    const found = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      return true;
    })()`);
    assert(found, `${label} was not found before scrolling`, selector);
    const geometry = await waitFor(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        innerHeight,
        innerWidth,
        fullyInsideViewport: rect.top >= 0 && rect.bottom <= innerHeight
      };
    })()`, value => value?.fullyInsideViewport === true);
    assert(
      geometry?.top >= 0 && geometry?.bottom <= geometry?.innerHeight,
      `${label} is not fully inside the viewport`,
      geometry
    );
    record(`${label}-viewport-geometry`, geometry);
    return geometry;
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  const preloadCleared = await waitFor(`document.querySelector('.theia-preload') === null`, value => value === true);
  assert(preloadCleared, 'Theia preload overlay did not clear', preloadCleared);

  const openCatalog = async () => {
    await ensureMaterialsVisible();
    await click('[data-akari-open-catalog]');
    const itemCount = await waitFor(
      `Number(document.querySelector('[data-akari-catalog-item-count]')?.getAttribute('data-akari-catalog-item-count') ?? -1)`,
      value => value === 1
    );
    assert(itemCount === 1, 'paid resolver catalog item did not load', itemCount);
  };

  if (scenario === 'revoked') {
    const home = await waitFor(`(() => {
      const card = document.querySelector('[data-akari-store-reconnect-required="true"]');
      if (!card) return null;
      const button = card.querySelector('[data-akari-store-connect]');
      return {
        stage: document.querySelector('[data-akari-home-stage]')?.getAttribute('data-akari-home-stage'),
        connection: card.getAttribute('data-akari-store-connection'),
        status: card.getAttribute('data-akari-store-entitlements-status'),
        text: card.textContent.replace(/\\s+/g, ' ').trim(),
        button: button?.textContent.trim() ?? null
      };
    })()`, value => value?.status === 'unauthorized');
    record('home-reconnect-required', home);
    assert(home.stage === 'dashboard', 'home dashboard is not visible', home);
    assert(home.connection === 'reconnect-required', 'home connection state is not reconnect-required', home);
    assert(home.text.includes('再接続が必要（別の端末で接続されたため解除された可能性）'), 'home guidance text is missing', home);
    assert(home.button === 'ストアに再接続する', 'home reconnect button is missing', home);
    await scrollFullyIntoView('[data-akari-store-reconnect-required="true"]', 'home-reconnect-card');
    await screenshot('01-home-reconnect-required.png');

    await openCatalog();
    const catalog = await waitFor(`(() => {
      const row = document.querySelector('[data-akari-catalog-entitlements-unauthorized="true"]');
      if (!row) return null;
      return {
        status: row.getAttribute('data-akari-catalog-entitlements-status'),
        text: row.textContent.replace(/\\s+/g, ' ').trim(),
        retryPresent: !!row.querySelector('[data-akari-catalog-retry]'),
        lockedState: document.querySelector('[data-akari-catalog-item="still/paid-revoked-sample"]')?.getAttribute('data-akari-catalog-item-state') ?? null
      };
    })()`, value => value?.status === 'unauthorized');
    record('catalog-reconnect-guidance', catalog);
    assert(catalog.text === 'ストア接続が解除されています — ホームから再接続してください', 'catalog reconnect guidance is incorrect', catalog);
    assert(catalog.retryPresent === false, 'unauthorized row must not show retry', catalog);
    assert(catalog.lockedState === 'locked', 'paid item no longer fails closed', catalog);
    await scrollFullyIntoView('[data-akari-catalog-entitlements-unauthorized="true"]', 'catalog-reconnect-row');
    await screenshot('02-catalog-reconnect-guidance.png');
  } else if (scenario === 'no-credentials') {
    const home = await waitFor(`(() => {
      const card = document.querySelector('[data-akari-store-connection="disconnected"]');
      if (!card) return null;
      return {
        stage: document.querySelector('[data-akari-home-stage]')?.getAttribute('data-akari-home-stage'),
        status: card.getAttribute('data-akari-store-entitlements-status'),
        reconnectPresent: !!document.querySelector('[data-akari-store-reconnect-required]'),
        text: card.textContent.replace(/\\s+/g, ' ').trim(),
        button: card.querySelector('[data-akari-store-connect]')?.textContent.trim() ?? null
      };
    })()`, value => value?.status === 'no_credentials');
    record('home-no-credentials', home);
    assert(home.stage === 'dashboard', 'home dashboard is not visible', home);
    assert(home.reconnectPresent === false, 'home must not show reconnect-required without credentials', home);
    assert(home.button === 'ストアに接続する', 'normal store connect button is missing', home);
    await scrollFullyIntoView('[data-akari-store-connection="disconnected"]', 'home-no-credentials-card');
    await screenshot('03-no-credentials-home.png');

    await openCatalog();
    const catalog = await evaluate(`(() => ({
      reconnectGuidancePresent: !!document.querySelector('[data-akari-catalog-entitlements-unauthorized]'),
      noticeRowPresent: !!document.querySelector('[data-akari-catalog-retry-row]'),
      retryPresent: !!document.querySelector('[data-akari-catalog-retry]'),
      lockedState: document.querySelector('[data-akari-catalog-item="still/paid-revoked-sample"]')?.getAttribute('data-akari-catalog-item-state') ?? null
    }))()`);
    record('catalog-no-credentials', catalog);
    assert(catalog.reconnectGuidancePresent === false, 'catalog must not show reconnect guidance without credentials', catalog);
    assert(catalog.noticeRowPresent === false && catalog.retryPresent === false, 'catalog must not show an entitlement notice without credentials', catalog);
    assert(catalog.lockedState === 'locked', 'paid item must remain locked without credentials', catalog);
    await scrollFullyIntoView('[data-akari-catalog-item="still/paid-revoked-sample"]', 'catalog-no-credentials-item');
    await screenshot('03-no-credentials-catalog.png');
  } else if (scenario === 'network-error') {
    await openCatalog();
    const catalog = await waitFor(`(() => {
      const row = document.querySelector('[data-akari-catalog-retry-row][data-akari-catalog-entitlements-status="error"]');
      if (!row) return null;
      return {
        text: row.textContent.replace(/\\s+/g, ' ').trim(),
        retryPresent: !!row.querySelector('[data-akari-catalog-retry]'),
        lockedState: document.querySelector('[data-akari-catalog-item="still/paid-revoked-sample"]')?.getAttribute('data-akari-catalog-item-state') ?? null
      };
    })()`, value => value?.retryPresent === true);
    record('catalog-network-error', catalog);
    assert(catalog.text.includes('アカウント素材の取得に失敗'), 'catalog fetch-failed guidance is missing', catalog);
    assert(catalog.retryPresent === true, 'network error must keep the retry button', catalog);
    assert(catalog.lockedState === 'locked', 'paid item must remain locked on network error', catalog);
    await scrollFullyIntoView('[data-akari-catalog-retry-row][data-akari-catalog-entitlements-status="error"]', 'catalog-network-error-row');
    await screenshot('04-network-error-catalog.png');
  } else {
    throw new Error(`unsupported scenario: ${scenario}`);
  }

  await writeFile(path.join(evidenceDir, `run-log-${scenario}.json`), `${JSON.stringify(log, null, 2)}\n`);
  cdp.detach();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => {
      console.log('[entitlements-visibility-l1] L1_OK');
      app.exit(0);
    }).catch(async error => {
      console.error('[entitlements-visibility-l1] L1_FAILED', error);
      try {
        await writeFile(path.join(evidenceDir, `run-log-${scenario}.json`), `${JSON.stringify([
          ...log,
          { step: 'failure', value: String(error.stack ?? error) }
        ], null, 2)}\n`);
      } catch { /* best effort */ }
      app.exit(1);
    });
  });
});
