// L1 hook (wrapper-authored, verification-only; not product source).
//
// 設定 →「接続と API キー」の fal 行に出る「既定モデル」ブロックを、本番ビルドの Electron
// 上で webContents.debugger（CDP）から観測し、動画の既定を Kling へ変えるところまでを行う。
// 実ファイル（<作業場>/.akari/connections.json）の検査は run-l1.mjs 側が行う。
const { app } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');

const evidenceDir = process.env.AKARI_L1_EVIDENCE_DIR;
const targetVideoModel = process.env.AKARI_L1_TARGET_VIDEO_MODEL;
const log = [];
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function record(step, value) {
  log.push({ step, value });
  console.log(`[generation-defaults-l1] ${step}`, JSON.stringify(value));
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
  const waitFor = async (expression, predicate, timeoutMs = 90000) => {
    const started = Date.now();
    let value;
    while (Date.now() - started < timeoutMs) {
      try {
        value = await evaluate(expression);
        if (predicate(value)) return value;
      } catch {
        // 起動直後は実行コンテキストが差し替わる。次のポーリングで回復する。
      }
      await sleep(400);
    }
    return value;
  };
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidenceDir, name), Buffer.from(data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  const preloadCleared = await waitFor("document.querySelector('.theia-preload') === null", value => value === true, 180000);
  assert(preloadCleared, 'Theia preload overlay did not clear', preloadCleared);

  // 本番の CommandRegistry を DI コンテナから引いて「設定 → 接続と API キー」を開く。
  const opened = await evaluate(`(() => {
    const bindings = window.theia.container._bindingDictionary;
    const key = [...bindings._map.keys()].find(candidate =>
      typeof candidate === 'function'
      && typeof candidate.prototype?.executeCommand === 'function'
      && typeof candidate.prototype?.registerCommand === 'function');
    if (!key) return { ok: false, reason: 'CommandRegistry not found' };
    const registry = window.theia.container.get(key);
    const known = !!registry.getCommand('akari.settings.open');
    void registry.executeCommand('akari.settings.open', { section: 'connections' });
    return { ok: true, known };
  })()`);
  record('open-settings-connections', opened);
  assert(opened?.ok === true && opened.known === true, 'akari.settings.open was not available', opened);

  const READ_BLOCK = `(() => {
    const block = document.querySelector('[data-akari-generation-defaults]');
    if (!block) return null;
    const read = kind => {
      const select = block.querySelector('select[data-akari-generation-default="' + kind + '"]');
      if (!select) return null;
      return {
        value: select.value,
        ariaLabel: select.getAttribute('aria-label'),
        optionCount: select.options.length,
        options: Array.from(select.options).map(option => option.value),
        labels: Array.from(select.options).map(option => option.textContent),
        selectedLabel: select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : null
      };
    };
    const sources = Array.from(block.querySelectorAll('[data-akari-generation-source]')).map(node => ({
      field: node.getAttribute('data-akari-generation-source-for'),
      source: node.getAttribute('data-akari-generation-source'),
      text: (node.textContent || '').trim()
    }));
    const falCard = block.closest('[data-akari-provider]');
    return {
      inFalCard: falCard ? falCard.getAttribute('data-akari-provider') : null,
      text: (block.textContent || '').replace(/\\s+/g, ' ').trim(),
      still: read('still'),
      video: read('video'),
      sources
    };
  })()`;

  const before = await waitFor(READ_BLOCK, value => value?.still?.optionCount > 0 && value?.video?.optionCount > 0);
  record('generation-defaults-before', before);
  assert(before?.inFalCard === 'fal', '既定モデルブロックが fal 行の中にない', before);
  assert(before.still.optionCount === 2, '静止画の選択肢が 2 行ではない', before.still);
  assert(before.video.optionCount === 12, '動画の選択肢が 12 行ではない', before.video);
  assert(before.still.value === 'codex:image', '静止画の既定が codex:image ではない', before.still);
  assert(before.video.value === 'fal:h3-i2v', '動画の既定が fal:h3-i2v ではない', before.video);
  assert(before.sources.every(entry => entry.source === 'default'), '出所が既定ではない', before.sources);
  assert(/2026-09-12 時点/.test(before.video.selectedLabel ?? ''), '事実帯に as_of が出ていない', before.video.selectedLabel);
  assert(/\$0\.05〜0\.16\/秒/.test(before.video.selectedLabel ?? ''), '事実帯に価格が出ていない', before.video.selectedLabel);
  await screenshot('01-settings-generation-defaults.png');

  const changed = await evaluate(`(() => {
    const select = document.querySelector('select[data-akari-generation-default="video"]');
    if (!select) return { ok: false, reason: 'select not found' };
    const target = ${JSON.stringify(targetVideoModel)};
    if (!Array.from(select.options).some(option => option.value === target)) {
      return { ok: false, reason: 'target option missing', options: Array.from(select.options).map(o => o.value) };
    }
    select.value = target;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: select.value };
  })()`);
  record('change-video-default', changed);
  assert(changed?.ok === true, '動画の既定を変えられなかった', changed);

  const after = await waitFor(READ_BLOCK, value =>
    value?.video?.value === targetVideoModel
    && value?.sources?.some(entry => entry.field === 'video' && entry.source === 'workspace'));
  record('generation-defaults-after', after);
  assert(after?.video?.value === targetVideoModel, '動画の既定が Kling に変わっていない', after?.video);
  assert(after.still.value === 'codex:image', '静止画の既定が巻き添えで変わった', after.still);
  const videoSource = after.sources.find(entry => entry.field === 'video');
  const stillSource = after.sources.find(entry => entry.field === 'still');
  assert(videoSource?.source === 'workspace', '動画の出所がワークスペースになっていない', after.sources);
  assert(videoSource?.text.includes('ワークスペース'), '出所の表示が「ワークスペース」ではない', after.sources);
  assert(stillSource?.source === 'default', '静止画の出所が巻き添えで変わった', after.sources);
  await screenshot('02-video-default-kling.png');

  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify(log, null, 2)}\n`);
  cdp.detach();
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    run(win).then(() => {
      console.log('[generation-defaults-l1] L1_OK');
      app.exit(0);
    }).catch(async error => {
      console.error('[generation-defaults-l1] L1_FAILED', error);
      try {
        await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify([
          ...log,
          { step: 'failure', value: String(error.stack ?? error) }
        ], null, 2)}\n`);
      } catch { /* best effort */ }
      app.exit(1);
    });
  });
});
