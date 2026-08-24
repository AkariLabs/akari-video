#!/usr/bin/env node
// L1 driver (instance 1): caption inline text edit acceptance measurements against a
// running production-build Electron. Raw CDP, Node built-ins only.
// Usage: node run-l1.mjs <cdp-port> <workspace-dir> <evidence-dir>
// Phases: baseline display -> Escape cancel (data invariant) -> seek-guard ->
//         Enter commit (text-only byte diff) -> zone regression -> blank delete.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [, , portArg, workspaceArg, evidenceArg] = process.argv;
const port = Number(portArg);
const workspace = workspaceArg;
const evidenceDirectory = evidenceArg;
if (!Number.isInteger(port) || !workspace || !evidenceDirectory) {
  throw new Error('usage: run-l1.mjs <cdp-port> <workspace-dir> <evidence-dir>');
}
const captionsPath = path.join(workspace, 'project', 'captions.json');
const NEW_TEXT = '編集後の字幕テスト';

const log = [];
const record = (step, detail = {}) => {
  log.push({ at: new Date().toISOString(), step, ...detail });
  console.log(`[${step}]`, JSON.stringify(detail));
};
const check = (condition, message, detail = {}) => {
  if (!condition) {
    record('ASSERTION-FAILED', { message, ...detail });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(detail)}`);
  }
  record('assert-ok', { message, ...detail });
};

class CDP {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  close() { this.socket.close(); }
}

const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());

async function evaluate(cdp, expression, contextId) {
  const result = await cdp.send('Runtime.evaluate', {
    expression, contextId, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function click(cdp, x, y, count = 1) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let index = 1; index <= count; index++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: index });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: index });
  }
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidenceDirectory, name), Buffer.from(data, 'base64'));
  record('screenshot', { name });
}

const readCaptions = () => readFile(captionsPath, 'utf8');
async function waitCaptionsChange(before, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await readCaptions();
    if (current !== before) return current;
    await sleep(200);
  }
  throw new Error('captions.json did not change in time');
}

// Visible caption text: clone the plate and drop inline <style> blocks that the
// styled fragment embeds (their CSS text otherwise pollutes textContent).
const PLATE_TEXT = `(() => {
  const plate = document.getElementById('caption-plate');
  const clone = plate.cloneNode(true);
  for (const style of clone.querySelectorAll('style')) style.remove();
  return clone.textContent.trim();
})`;

// Deterministically drive the webview clock to an output time, then read the caption plate.
const seekAndRead = time => `(() => {
  const video = document.getElementById('preview-video');
  video.pause();
  video.currentTime = ${time};
  return new Promise(resolve => {
    const finish = () => {
      window.akari.runtime.tick(video.currentTime, false);
      requestAnimationFrame(() => {
        resolve({ currentTime: video.currentTime, plateText: ${PLATE_TEXT}() });
      });
    };
    if (Math.abs(video.currentTime - ${time}) < 0.001) finish();
    else video.addEventListener('seeked', finish, { once: true });
  });
})()`;

// Retry a seek+read until the plate carries the expected text (initial render race).
// Begin an inline edit on the cue expected at `time`, verifying the edit targets it.
// Guards against transport-driven rerenders racing the dblclick (retry with Escape).
const beginEditOn = async (cdp, contextId, time, expectedText) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const shown = await seekUntilText(cdp, contextId, time, expectedText, 10000);
    if (shown.plateText !== expectedText) continue;
    await evaluate(cdp, dblclickPlate, contextId);
    await sleep(300);
    const state = await evaluate(cdp, EDIT_STATE, contextId);
    if (state.editing && state.editText === expectedText) return state;
    if (state.editing) { await evaluate(cdp, keyInEdit('Escape'), contextId); await sleep(400); }
  }
  throw new Error(`could not begin edit on the cue showing ${expectedText}`);
};

const seekUntilText = async (cdp, contextId, time, expected, timeoutMs = 20000) => {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate(cdp, seekAndRead(time), contextId);
    if (last.plateText === expected) return last;
    await sleep(500);
  }
  return last;
};

const EDIT_STATE = `(() => {
  const editing = document.querySelector('[data-akari-caption-editing="true"]');
  const video = document.getElementById('preview-video');
  return {
    editing: Boolean(editing),
    contentEditable: editing ? editing.getAttribute('contenteditable') : null,
    editText: editing ? editing.textContent : null,
    focused: editing ? document.activeElement === editing : false,
    videoPaused: video.paused,
    plateText: (() => {
      const plate = document.getElementById('caption-plate');
      const clone = plate.cloneNode(true);
      for (const style of clone.querySelectorAll('style')) style.remove();
      return clone.textContent.trim();
    })(),
  };
})()`;

const dblclickPlate = `(() => {
  const plate = document.getElementById('caption-plate');
  plate.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  return true;
})()`;

const typeInEdit = text => `(() => {
  const editing = document.querySelector('[data-akari-caption-editing="true"]');
  if (!editing) return { ok: false };
  editing.textContent = ${JSON.stringify(text)};
  return { ok: true };
})()`;

const keyInEdit = key => `(() => {
  const editing = document.querySelector('[data-akari-caption-editing="true"]');
  if (!editing) return { ok: false };
  editing.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
  return { ok: true };
})()`;

await mkdir(evidenceDirectory, { recursive: true });
let main;
let outer;
try {
  // --- boot / open preview (same route as evidence/emphasis-render) ---
  let mainTarget;
  for (let attempt = 0; attempt < 60 && !mainTarget; attempt++) {
    mainTarget = (await targets().catch(() => [])).find(target => target.type === 'page');
    if (!mainTarget) await sleep(300);
  }
  if (!mainTarget) throw new Error('main page target not found');
  main = new CDP(mainTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('Page.bringToFront');
  record('connected-main');

  await (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180000) {
      const ready = await evaluate(main, `Boolean(Array.from(document.querySelectorAll('.codicon-settings-gear')).find(item => item.getBoundingClientRect().width > 0))`);
      if (ready) return;
      await sleep(500);
    }
    throw new Error('workbench did not become ready');
  })();
  await shot(main, '00-boot.png');

  // dismiss the "use this folder as an AKARI project?" prompt without scaffolding
  const dismissed = await evaluate(main, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find(item =>
      item.textContent.trim() === '開くだけ' && item.getBoundingClientRect().width > 0);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  record('project-prompt', { dismissed });
  await sleep(500);

  // developer mode exposes the plain file explorer used by this harness.
  // Idempotent: skip when tree rows are already visible; click the checkbox only when unchecked.
  const treeAlreadyVisible = await evaluate(main, `(() => {
    const row = document.querySelector('.theia-TreeNode');
    return Boolean(row && row.getBoundingClientRect().width > 0);
  })()`);
  if (!treeAlreadyVisible) {
    let checkbox = await evaluate(main, `(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const developer = boxes.find(box => {
        if (box.getBoundingClientRect().width === 0) return false;
        const scope = box.closest('label, div, li, section') || box.parentElement;
        return Boolean(scope && /developer/i.test(scope.textContent || ''));
      });
      if (!developer) return null;
      const rect = developer.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, checked: developer.checked };
    })()`);
    if (!checkbox) {
      const gear = await evaluate(main, `(() => {
        const element = Array.from(document.querySelectorAll('.codicon-settings-gear')).find(item => item.getBoundingClientRect().width > 0);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (!gear) throw new Error('settings gear icon not found');
      await click(main, gear.x, gear.y);
      await sleep(1000);
      checkbox = await evaluate(main, `(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const developer = boxes.find(box => {
        if (box.getBoundingClientRect().width === 0) return false;
        const scope = box.closest('label, div, li, section') || box.parentElement;
        return Boolean(scope && /developer/i.test(scope.textContent || ''));
      });
      if (!developer) return null;
      const rect = developer.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, checked: developer.checked };
    })()`);
    }
    if (!checkbox) throw new Error('developer mode checkbox not found');
    if (!checkbox.checked) {
      await click(main, checkbox.x, checkbox.y);
      await sleep(700);
    }
    const checkedNow = await evaluate(main, `(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const developer = boxes.find(box => {
        const scope = box.closest('label, div, li, section') || box.parentElement;
        return Boolean(scope && /developer/i.test(scope.textContent || ''));
      });
      return developer ? developer.checked : null;
    })()`);
    record('developer-mode', { checkedBefore: checkbox.checked, checkedNow });
    check(checkedNow === true, 'developer mode enabled', { checkedNow });
  } else {
    record('developer-mode', { skipped: 'tree already visible' });
  }

  let explorerOpen = false;
  for (let attempt = 0; attempt < 15 && !explorerOpen; attempt++) {
    const state = await evaluate(main, `(() => {
      const row = document.querySelector('.theia-TreeNode');
      const alreadyOpen = Boolean(row && row.getBoundingClientRect().width > 0);
      const icon = Array.from(document.querySelectorAll('.codicon-files')).find(item => item.getBoundingClientRect().width > 0);
      const rect = icon ? icon.getBoundingClientRect() : null;
      return { alreadyOpen, x: rect ? rect.left + rect.width / 2 : 0, y: rect ? rect.top + rect.height / 2 : 0 };
    })()`);
    explorerOpen = state.alreadyOpen;
    if (!explorerOpen && state.x) { await click(main, state.x, state.y); await sleep(1000); }
  }
  check(explorerOpen, 'file explorer tree became visible');
  const row = label => evaluate(main, `(() => {
    const item = Array.from(document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]')).find(node => node.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    const rect = item.getBoundingClientRect();
    return { collapsed: Boolean(item.querySelector('.theia-mod-collapsed')), x: rect.left + 20, y: rect.top + rect.height / 2 };
  })()`);
  let editRow = await row('edit.json');
  for (let attempt = 0; attempt < 6 && !editRow; attempt++) {
    const projectRow = await row('project');
    if (projectRow) { await click(main, projectRow.x, projectRow.y); await sleep(800); }
    editRow = await row('edit.json');
  }
  if (!editRow) throw new Error('edit.json tree row not found');
  await click(main, editRow.x, editRow.y, 2);
  await sleep(2000);
  record('preview-open-requested');

  // connect a webview iframe target and return { cdp, context, captionCount }
  const connectWebview = async target => {
    const cdp = new CDP(target.webSocketDebuggerUrl);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', params => contexts.push(params.context));
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await sleep(700);
    const frameTree = await cdp.send('Page.getFrameTree');
    const topFrame = frameTree.frameTree.frame.id;
    const context = contexts.find(candidate => candidate.auxData?.frameId !== topFrame);
    if (!context) { cdp.close(); return null; }
    const captionCount = await evaluate(cdp, `window.__akariPreview?.captions?.length ?? -1`, context.id).catch(() => -1);
    return { cdp, context, captionCount };
  };
  const webviewTargets = async () => (await targets()).filter(target => target.type === 'iframe' && /webview\/index\.html/.test(target.url));

  // pick the webview whose initial state carries the caption list
  // (edit.json opens the output preview directly via AkariOutputPreviewOpenHandler)
  let context = null;
  for (let attempt = 0; attempt < 40 && !context; attempt++) {
    for (const candidate of await webviewTargets()) {
      const connection = await connectWebview(candidate).catch(() => null);
      if (connection && connection.captionCount > 0) {
        outer = connection.cdp;
        context = connection.context;
        record('connected-webview', { captionCount: connection.captionCount });
        break;
      }
      connection?.cdp.close();
    }
    if (!context) await sleep(400);
  }
  if (!context) throw new Error('output preview webview (with captions) not found');

  // wait for the preview runtime + video to be ready
  await (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const ready = await evaluate(outer, `(() => {
        const video = document.getElementById('preview-video');
        return Boolean(video && video.readyState >= 2 && window.akari && window.akari.runtime && window.akari.engine);
      })()`, context.id).catch(() => false);
      if (ready) return;
      await sleep(500);
    }
    throw new Error('preview runtime not ready');
  })();

  // --- phase 0: baseline display ---
  const baseline = await seekUntilText(outer, context.id, 1.0, 'こんにちは世界');
  check(baseline.plateText === 'こんにちは世界', 'baseline caption shows original text at t=1.0', baseline);
  const baselineOther = await seekUntilText(outer, context.id, 2.8, '触らない字幕');
  check(baselineOther.plateText === '触らない字幕', 'second cue shows at t=2.8 (timing baseline)', baselineOther);
  await evaluate(outer, seekAndRead(1.0), context.id);
  const bytes0 = await readCaptions();
  await shot(main, '01-preview-baseline.png');

  // --- phase 1: pause-on-edit + Escape cancel keeps data byte-identical ---
  await evaluate(outer, `(() => { document.getElementById('play-toggle').click(); return true; })()`, context.id);
  await sleep(400);
  const playing = await evaluate(outer, `(() => ({ paused: document.getElementById('preview-video').paused }))()`, context.id);
  check(playing.paused === false, 'playback started before dblclick', playing);
  await evaluate(outer, dblclickPlate, context.id);
  await sleep(300);
  let state = await evaluate(outer, EDIT_STATE, context.id);
  check(state.editing && state.contentEditable === 'true', 'dblclick during playback enters contenteditable edit', state);
  check(state.videoPaused === true, 'beginCaptionEdit pauses playback', state);
  check(state.focused === true, 'editing element receives focus', state);
  await shot(main, '02-editing-active.png');
  await evaluate(outer, typeInEdit('改変テスト（キャンセルされるべき）'), context.id);
  await evaluate(outer, keyInEdit('Escape'), context.id);
  await sleep(400);
  state = await evaluate(outer, EDIT_STATE, context.id);
  check(!state.editing, 'Escape leaves edit mode', state);
  const afterEscapeRead = await seekUntilText(outer, context.id, 1.0, 'こんにちは世界');
  check(afterEscapeRead.plateText === 'こんにちは世界', 'Escape restores original caption text', afterEscapeRead);
  await sleep(600);
  const bytesAfterEscape = await readCaptions();
  check(bytesAfterEscape === bytes0, 'captions.json is byte-identical after Escape cancel');
  await shot(main, '03-after-escape.png');

  // --- phase 2: seek during edit does not destroy the edit (guard) ---
  await beginEditOn(outer, context.id, 1.0, 'こんにちは世界');
  await evaluate(outer, typeInEdit('ガード確認'), context.id);
  await evaluate(outer, `(() => {
    const video = document.getElementById('preview-video');
    video.currentTime = 2.8;
    return new Promise(resolve => {
      const finish = () => { window.akari.runtime.tick(video.currentTime, false); requestAnimationFrame(() => resolve(true)); };
      video.addEventListener('seeked', finish, { once: true });
    });
  })()`, context.id);
  state = await evaluate(outer, EDIT_STATE, context.id);
  check(state.editing && state.editText === 'ガード確認', 'seek to another cue window keeps the in-progress edit', state);
  await evaluate(outer, keyInEdit('Escape'), context.id);
  await sleep(400);
  const afterGuardCancel = await seekUntilText(outer, context.id, 2.8, '触らない字幕');
  check(afterGuardCancel.plateText === '触らない字幕', 'cancel after seek rerenders the cue for the current time', afterGuardCancel);
  const bytesAfterGuard = await readCaptions();
  check(bytesAfterGuard === bytes0, 'captions.json untouched by guarded edit + cancel');

  // --- phase 3: Enter commit writes text-only diff ---
  await beginEditOn(outer, context.id, 1.0, 'こんにちは世界');
  await evaluate(outer, typeInEdit(NEW_TEXT), context.id);
  await evaluate(outer, keyInEdit('Enter'), context.id);
  const bytesAfterCommit = await waitCaptionsChange(bytes0);
  const expectedRoot = JSON.parse(bytes0);
  expectedRoot[0].text = NEW_TEXT;
  const expectedBytes = `${JSON.stringify(expectedRoot, undefined, 2)}\n`;
  check(bytesAfterCommit === expectedBytes,
    'commit changes ONLY c-0001.text (timing/zone/other cue byte-identical)',
    { expectedBytes, actualBytes: bytesAfterCommit });
  await sleep(800);
  const afterCommitRead = await seekUntilText(outer, context.id, 1.0, NEW_TEXT);
  check(afterCommitRead.plateText === NEW_TEXT, 'plate shows edited text after commit', afterCommitRead);
  await shot(main, '04-after-commit.png');

  // --- phase 4: zone write regression through the same request channel ---
  const zoneResult = await evaluate(outer, `window.akari.engine.captionWrite('c-0001', { zone: 'top' }).then(() => ({ ok: true })).catch(error => ({ ok: false, message: String(error) }))`, context.id);
  check(zoneResult.ok, 'zone write still succeeds after text patch support', zoneResult);
  const bytesAfterZone = await waitCaptionsChange(bytesAfterCommit);
  const zoneRoot = JSON.parse(bytesAfterZone);
  check(zoneRoot[0].text === NEW_TEXT && zoneRoot[0].text_style.zone === 'top'
    && JSON.stringify(zoneRoot[1]) === JSON.stringify(expectedRoot[1]),
    'zone write updates zone only, edited text preserved', { cue: zoneRoot[0] });
  const zoneBack = await evaluate(outer, `window.akari.engine.captionWrite('c-0001', { zone: 'bottom' }).then(() => ({ ok: true })).catch(error => ({ ok: false, message: String(error) }))`, context.id);
  check(zoneBack.ok, 'zone write back to bottom succeeds', zoneBack);
  const bytesZoneBack = await waitCaptionsChange(bytesAfterZone);
  check(bytesZoneBack === expectedBytes, 'zone round-trip returns to the committed bytes');

  // --- phase 5: blank commit deletes the cue (adjudication) ---
  state = await beginEditOn(outer, context.id, 2.8, '触らない字幕');
  check(state.editing && state.editText === '触らない字幕', 'dblclick on second cue enters edit', state);
  await evaluate(outer, typeInEdit('   '), context.id);
  await evaluate(outer, keyInEdit('Enter'), context.id);
  const bytesAfterDelete = await waitCaptionsChange(bytesZoneBack);
  const deleteRoot = JSON.parse(bytesAfterDelete);
  const expectedAfterDelete = `${JSON.stringify([expectedRoot[0]], undefined, 2)}\n`;
  check(bytesAfterDelete === expectedAfterDelete, 'blank commit removes only that cue', { cues: deleteRoot.length });
  await sleep(800);
  const afterDeleteRead = await seekUntilText(outer, context.id, 2.8, '');
  check(afterDeleteRead.plateText === '', 'plate is empty where the deleted cue used to be', afterDeleteRead);
  await shot(main, '05-after-blank-delete.png');

  record('instance-1-complete');
} finally {
  outer?.close();
  main?.close();
  const sanitized = JSON.parse(JSON.stringify(log).split(workspace).join('<workspace>'));
  await writeFile(path.join(evidenceDirectory, 'run-log.json'), `${JSON.stringify({ phase: 'instance-1', log: sanitized }, null, 2)}\n`);
}
