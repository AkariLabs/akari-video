#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { connectMain, evalOn } from '../preview-writeback-v2/scripts/lib.mjs';
import { screenshot } from '../preview-writeback-v2/scripts/cdp-lib.mjs';
import { connectItemKeyframesPreview } from './connect-preview.mjs';

const [portText, projectDirArgument, evidenceDir, label] = process.argv.slice(2);
if (!portText || !projectDirArgument || !evidenceDir || !label) {
  throw new Error('usage: run-l1.mjs <port> <project-dir> <evidence-dir> <label>');
}

const port = Number(portText);
const projectDir = await realpath(projectDirArgument);
assert.equal(path.resolve(projectDirArgument), projectDir,
  `projectDir must be a realpath (use /private/tmp, not /tmp): ${projectDirArgument}`);
assert.ok(projectDir.startsWith('/private/tmp/'), `fixture must be under /private/tmp: ${projectDir}`);
await mkdir(evidenceDir, { recursive: true });
const editPath = path.join(projectDir, 'edit.json');
const motionPath = path.join(projectDir, 'motion', 's01.json');
const editUri = pathToFileURL(editPath).href;
const observations = [];
const hostWarnings = [];
const record = (step, value) => {
  observations.push({ step, ...value });
  console.log(`[${step}] ${JSON.stringify(value)}`);
};

let main;
let preview;
const waitFor = async (labelText, predicate, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(`timed out: ${labelText}; last=${JSON.stringify(last)}`);
};

try {
  main = await connectMain(port);
  main.on('Runtime.consoleAPICalled', event => {
    const values = event.args?.map(arg => arg.value ?? arg.description ?? arg.type) ?? [];
    if (event.type === 'warning') hostWarnings.push(values.join(' '));
  });
  await waitFor('Theia ready', () => evalOn(main,
    'Boolean(window.theia && window.theia.container)'), 60_000);
  const opened = await evalOn(main, `(async () => {
    const bindings = window.theia.container._bindingDictionary;
    const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function'
      && typeof key.prototype?.registerCommand === 'function');
    if (!commandClass) return false;
    await window.theia.container.get(commandClass).executeCommand('akari.preview.ensureVisible', {
      editUri: ${JSON.stringify(editUri)}
    });
    return true;
  })()`);
  assert.equal(opened, true);
  preview = await connectItemKeyframesPreview(port);

  const command = expression => evalOn(main, `(async () => {
    const bindings = window.theia.container._bindingDictionary;
    const commandClass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function'
      && typeof key.prototype?.registerCommand === 'function');
    if (!commandClass) return false;
    ${expression}
    return true;
  })()`);
  const view = expression => evalOn(preview.cdp, expression, preview.contextId);
  const readState = () => view(`(() => {
    const state = id => {
      const container = document.querySelector('[data-overlay-id="' + id + '"]');
      if (!container) return null;
      const style = getComputedStyle(container);
      return {
        x: style.getPropertyValue('--x').trim(),
        opacity: style.opacity,
        inlineOpacity: container.style.getPropertyValue('opacity'),
        visible: style.visibility
      };
    };
    const video = document.getElementById('preview-video');
    return {
      timeOrigin: performance.timeOrigin,
      seek: Number(document.getElementById('seek')?.value),
      stageReady: Boolean(document.getElementById('preview-stage')),
      frameEngineActive: document.getElementById('preview-stage')?.dataset.frameEngineActive ?? 'false',
      playLabel: document.getElementById('play-toggle')?.getAttribute('aria-label') ?? '',
      video: { paused: video?.paused ?? null, currentTime: Number(video?.currentTime ?? NaN) },
      plain: state('plain'),
      bag: state('s01.B'),
      group: state('g1.first'),
      control: state('s01.C')
    };
  })()`);
  const seekTo = async seconds => {
    assert.equal(await command(`await window.theia.container.get(commandClass).executeCommand(
      'akari.preview.seekOutput', { editUri: ${JSON.stringify(editUri)}, time: ${seconds} }
    );`), true);
    return waitFor(`seek ${seconds}`, async () => {
      const state = await readState();
      return state.stageReady && Math.abs(state.seek - seconds) <= 0.035 ? state : false;
    });
  };

  const first = await seekTo(1.1);
  const second = await seekTo(2.4);
  assert.ok(first.plain && first.bag && first.group && first.control);
  assert.ok(second.plain && second.bag && second.group && second.control);
  assert.ok(Math.abs(Number.parseFloat(first.plain.x) - 110) <= 1, first.plain.x);
  assert.ok(Math.abs(Number.parseFloat(second.plain.x) - 240) <= 1, second.plain.x);
  assert.notEqual(first.bag.x, second.bag.x);
  assert.equal(first.group.opacity, '0.275');
  assert.equal(second.group.opacity, '0.6');
  assert.equal(first.control.x, second.control.x);
  assert.equal(first.control.inlineOpacity, '');
  record('seek-samples', { first, second });

  const playBefore = await seekTo(1.0);
  await view(`document.getElementById('play-toggle')?.click()`);
  const playStarted = await waitFor('playback started', async () => {
    const state = await readState();
    return state.plain && state.seek > playBefore.seek ? state : false;
  });
  await screenshot(main, path.join(evidenceDir, `${label}-play-start.png`));
  const playAdvanced = await waitFor('playback advanced', async () => {
    const state = await readState();
    return state.seek >= playStarted.seek + 0.6
      && state.plain && state.plain.x !== playStarted.plain.x ? state : false;
  });
  await screenshot(main, path.join(evidenceDir, `${label}-play-end.png`));
  assert.ok(playAdvanced.seek >= playStarted.seek + 0.6,
    `seek did not advance by 0.6s: ${playStarted.seek} -> ${playAdvanced.seek}`);
  assert.notEqual(playStarted.plain.x, playAdvanced.plain.x);
  await view(`document.getElementById('play-toggle')?.click()`);
  const playStopped = await waitFor('playback stopped', async () => {
    const state = await readState();
    return state.playLabel === '再生' ? state : false;
  });
  record('playback', { playBefore, playStarted, playAdvanced, playStopped });

  const originalTimeOrigin = second.timeOrigin;
  assert.equal(playAdvanced.timeOrigin, originalTimeOrigin);
  const edit = JSON.parse(await readFile(editPath, 'utf8'));
  edit.tracks[1].items[0].keyframes[1].transform.x = 800;
  await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  await seekTo(2.4);
  const inlineUpdated = await waitFor('inline keyframes update', async () => {
    const state = await readState();
    return Math.abs(Number.parseFloat(state.plain?.x) - 480) <= 1 ? state : false;
  });
  assert.equal(inlineUpdated.timeOrigin, originalTimeOrigin);
  record('inline-update', { inlineUpdated });

  const motion = JSON.parse(await readFile(motionPath, 'utf8'));
  motion.items['s01.B'].at(-1).transform.x = 720;
  const bagBefore = inlineUpdated.bag.x;
  await writeFile(motionPath, `${JSON.stringify(motion, null, 2)}\n`);
  const bagUpdated = await waitFor('motion bag update', async () => {
    const state = await readState();
    return state.bag?.x !== bagBefore ? state : false;
  });
  assert.equal(bagUpdated.timeOrigin, originalTimeOrigin);
  record('bag-update', { bagBefore, bagUpdated });

  await unlink(motionPath);
  const bagMissing = await waitFor('motion bag missing fallback', async () => {
    const state = await readState();
    return state.stageReady && state.bag?.x === '0px' ? state : false;
  });
  assert.equal(bagMissing.timeOrigin, originalTimeOrigin);
  assert.equal(bagMissing.stageReady, true);
  const motionWarnings = await waitFor('motion bag warning', () => {
    const values = hostWarnings.filter(value => value.includes('motion bag motion/s01.json'));
    return values.length > 0 ? values : false;
  });
  record('bag-missing', { bagMissing, warnings: motionWarnings });

  const result = { status: 'PASS', label, projectDir, observations };
  await writeFile(path.join(evidenceDir, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`ITEM KEYFRAMES L1 PASS ${label}`);
} catch (error) {
  await writeFile(path.join(evidenceDir, `${label}.json`), `${JSON.stringify({
    status: 'FAIL', label, projectDir, observations,
    error: error instanceof Error ? error.stack ?? error.message : String(error)
  }, null, 2)}\n`);
  throw error;
} finally {
  if (preview) {
    try { preview.cdp.close(); } catch {}
  }
  if (main) {
    try { await main.send('Browser.close', {}, 5_000); } catch {}
    try { main.close(); } catch {}
  }
}
