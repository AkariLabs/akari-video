import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { computeTransitionVisual } from '../lib/common/transition-visual.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const compiled = readFileSync(join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'), 'utf8');
const { TRANSITION_BY_ID, TRANSITION_VOCABULARY } = createRequire(import.meta.url)(
  '../../../../../packages/edit-store/lib/index.js'
);

const visual = (type, progress) => {
  const definition = TRANSITION_BY_ID[type];
  return computeTransitionVisual(definition.previewKind, progress, definition.labelJa);
};

function extractTemplate(methodName) {
  const methodAt = compiled.lastIndexOf(`${methodName}()`);
  assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
  const tick = compiled.indexOf('`', methodAt);
  assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
  let index = tick + 1;
  let output = '';
  while (index < compiled.length) {
    const character = compiled[index];
    if (character === '\\') {
      const next = compiled[index + 1];
      if (next === 'n') output += '\n';
      else if (next === 't') output += '\t';
      else if (next === 'r') output += '\r';
      else output += next;
      index += 2;
      continue;
    }
    if (character === '`') break;
    if (character === '$' && compiled[index + 1] === '{') {
      let braces = 1;
      index += 2;
      while (index < compiled.length && braces > 0) {
        const nested = compiled[index];
        if (nested === '\\') { index += 2; continue; }
        if (nested === '{') braces += 1;
        else if (nested === '}') braces -= 1;
        index += 1;
      }
      output += '0';
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

const bootstrap = extractTemplate('previewBootstrapScript');

function extractConstArrow(name, nextName) {
  const start = bootstrap.indexOf(`const ${name} =`);
  const end = bootstrap.indexOf(`const ${nextName} =`, start);
  assert.ok(start >= 0 && end > start, `${name} .. ${nextName}`);
  const declaration = bootstrap.slice(start, end).trim().replace(/;$/u, '');
  return declaration.slice(declaration.indexOf('=') + 1).trim();
}

test('3 エンジンの強度は progress の mid または progress 自体から決定する', () => {
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const mid = 1 - Math.abs(2 * progress - 1);
    assert.equal(visual('blur', progress).blurStdDeviationRatio, mid * 0.075);
    assert.equal(visual('pixelize', progress).pixelBlockRatio, mid / 22);
    assert.equal(visual('dissolve', progress).dissolveVisibleRatio, progress);
  }
});

test('3 エンジンは同じ progress で決定論的な値を返す', () => {
  for (const type of ['blur', 'pixelize', 'dissolve']) {
    assert.deepEqual(visual(type, 0.375), visual(type, 0.375), type);
  }
});

test('特殊 3 種以外の 26 種は engine none かつ強度比 0 のまま', () => {
  const ordinary = TRANSITION_VOCABULARY.filter(
    definition => !['blur', 'pixelize', 'dissolve'].includes(definition.id)
  );
  assert.equal(ordinary.length, 26);
  for (const definition of ordinary) {
    const result = visual(definition.id, 0.5);
    assert.equal(result.engine, 'none', definition.id);
    assert.equal(result.blurStdDeviationRatio, 0, definition.id);
    assert.equal(result.pixelBlockRatio, 0, definition.id);
    assert.equal(result.dissolveVisibleRatio, 0, definition.id);
  }
});

test('block size と dissolve table は VM で境界値を含めて実行できる', () => {
  const calibratedVisibleSlots = [
    0, 20, 26, 30, 33, 36, 39, 41, 44, 46, 48, 51, 53, 55, 58, 60, 62,
    65, 67, 70, 72, 75, 78, 81, 84, 88, 92, 96, 100, 106, 112, 122, 256
  ];
  const blockSize = vm.runInNewContext(
    `(${extractConstArrow('transitionEngineBlockSize', 'transitionDissolveTableValues')})`
  );
  const dissolveTable = vm.runInNewContext(
    `(${extractConstArrow('transitionDissolveTableValues', 'drawTransitionPixelize')})`,
    { DISSOLVE_VISIBLE_SLOTS: calibratedVisibleSlots }
  );
  assert.equal(blockSize(0, 1280), 1);
  assert.equal(blockSize(0.01, 1280), 13);
  const countVisible = (progress, slots = 256) =>
    dissolveTable(progress, slots).split(' ').filter(value => value === '1').length;
  assert.equal(countVisible(0), 0);
  assert.equal(countVisible(1 / 32), 20);
  assert.equal(countVisible(0.1), 31);
  assert.equal(countVisible(0.25), 44);
  assert.equal(countVisible(0.5), 62);
  assert.equal(countVisible(0.75), 84);
  assert.equal(countVisible(0.9), 105);
  assert.equal(countVisible(1), 256);
  assert.equal(countVisible(0.5, 32), 8, '256 スロット較正値を任意 slots へ比率換算する');
  let previous = -1;
  for (let step = 0; step <= 128; step += 1) {
    const current = countVisible(step / 128);
    assert.ok(current >= previous, `p=${step / 128}`);
    previous = current;
  }
});

test('pixelize 描画は contain 合成を毎回 clear して nearest-neighbor 拡大する', () => {
  let commandSink = [];
  const reducedCanvases = [];
  const contextWithLog = prefix => {
    const context = {
      clearRect: (...args) => commandSink.push([`${prefix}.clearRect`, ...args]),
      drawImage: (...args) => commandSink.push([
        `${prefix}.drawImage`,
        args[0]?.id || args[0]?.tagName || 'canvas',
        ...args.slice(1)
      ])
    };
    Object.defineProperty(context, 'globalAlpha', {
      set: value => commandSink.push([`${prefix}.globalAlpha`, value])
    });
    Object.defineProperty(context, 'imageSmoothingEnabled', {
      set: value => commandSink.push([`${prefix}.imageSmoothingEnabled`, value])
    });
    Object.defineProperty(context, 'webkitImageSmoothingEnabled', {
      set: value => commandSink.push([`${prefix}.webkitImageSmoothingEnabled`, value])
    });
    return context;
  };
  const mainContext = contextWithLog('main');
  const sandbox = {
    document: {
      createElement: tagName => {
        assert.equal(tagName, 'canvas');
        const reduced = { id: 'reduced', width: 0, height: 0 };
        reduced.getContext = () => contextWithLog('reduced');
        reducedCanvases.push(reduced);
        return reduced;
      }
    }
  };
  const draw = vm.runInNewContext(
    `(${extractConstArrow('drawTransitionPixelize', 'createTransitionPixelizeReadyHooks')})`,
    sandbox
  );
  const canvas = { width: 1280, height: 720, getContext: () => mainContext };
  const outgoing = { id: 'outgoing', tagName: 'VIDEO', readyState: 2, videoWidth: 1920, videoHeight: 1080 };
  const incoming = { id: 'incoming', tagName: 'IMG', naturalWidth: 1000, naturalHeight: 1000 };
  const run = () => {
    commandSink = [];
    reducedCanvases.length = 0;
    assert.equal(draw(canvas, outgoing, incoming, 64, 0.25), true);
    return {
      commands: structuredClone(commandSink),
      size: [reducedCanvases[0].width, reducedCanvases[0].height]
    };
  };
  const first = run();
  const second = run();
  assert.deepEqual(second, first);
  assert.equal(first.commands[0][0], 'main.clearRect');
  assert.deepEqual(first.size, [20, 12]);
  assert.ok(first.commands.some(command =>
    command[0] === 'main.imageSmoothingEnabled' && command[1] === false));
  assert.ok(first.commands.some(command =>
    command[0] === 'main.webkitImageSmoothingEnabled' && command[1] === false));
  assert.deepEqual(
    first.commands.find(command => command[0] === 'main.drawImage'),
    ['main.drawImage', 'reduced', 0, 0, 20, 12, 0, -24, 1280, 768]
  );
  const incomingAlpha = first.commands.findIndex(command =>
    command[0] === 'reduced.globalAlpha' && command[1] === 0.25);
  const incomingDraw = first.commands.findIndex(command =>
    command[0] === 'reduced.drawImage' && command[1] === 'incoming');
  assert.ok(incomingAlpha >= 0 && incomingDraw > incomingAlpha);

  const secondVideo = { ...outgoing, id: 'incoming-video' };
  const secondImage = { ...incoming, id: 'outgoing-image' };
  for (const [outgoingSource, incomingSource] of [
    [outgoing, secondVideo],
    [outgoing, incoming],
    [secondImage, secondVideo],
    [secondImage, incoming]
  ]) {
    assert.equal(draw(canvas, outgoingSource, incomingSource, 64, 0.5), true);
  }
  assert.equal(draw(
    canvas,
    { ...outgoing, readyState: 1 },
    { ...incoming, naturalWidth: 0 },
    64,
    0.5
  ), false);

  commandSink = [];
  reducedCanvases.length = 0;
  const measuredCanvas = { width: 640, height: 360, getContext: () => mainContext };
  assert.equal(draw(measuredCanvas, outgoing, incoming, 29, 0.5), true);
  assert.deepEqual([reducedCanvases[0].width, reducedCanvases[0].height], [23, 13]);
  assert.deepEqual(
    commandSink.find(command => command[0] === 'main.drawImage'),
    ['main.drawImage', 'reduced', 0, 0, 23, 13, -14, -9, 667, 377]
  );
});

test('pixelize 準備完了フックは二重登録せず発火・reset で全解除する', () => {
  const createHooks = vm.runInNewContext(
    `(${extractConstArrow('createTransitionPixelizeReadyHooks', 'transitionPixelizeReadyHooks')})`
  );
  const fakeElement = tagName => {
    const listeners = new Map();
    const additions = new Map();
    const removals = new Map();
    return {
      tagName,
      listeners,
      additions,
      removals,
      addEventListener(eventName, listener, options) {
        assert.equal(options?.once, true);
        listeners.set(eventName, listener);
        additions.set(eventName, (additions.get(eventName) || 0) + 1);
      },
      removeEventListener(eventName, listener) {
        if (listeners.get(eventName) === listener) listeners.delete(eventName);
        removals.set(eventName, (removals.get(eventName) || 0) + 1);
      },
      dispatch(eventName) {
        listeners.get(eventName)?.();
      }
    };
  };
  let rerenders = 0;
  const hooks = createHooks(() => { rerenders += 1; });
  const video = fakeElement('VIDEO');
  const image = fakeElement('IMG');

  hooks.arm(video);
  hooks.arm(video);
  hooks.arm(image);
  hooks.arm(image);
  assert.equal(video.additions.get('loadeddata'), 1);
  assert.equal(video.additions.get('seeked'), 1);
  assert.equal(image.additions.get('load'), 1);
  assert.deepEqual([...video.listeners.keys()], ['loadeddata', 'seeked']);
  assert.deepEqual([...image.listeners.keys()], ['load']);

  video.dispatch('seeked');
  assert.equal(rerenders, 1);
  assert.equal(video.listeners.size, 0);
  assert.equal(image.listeners.size, 0);
  assert.equal(video.removals.get('loadeddata'), 1);
  assert.equal(video.removals.get('seeked'), 1);
  assert.equal(image.removals.get('load'), 1);

  hooks.arm(video);
  hooks.arm(image);
  hooks.reset();
  assert.equal(video.listeners.size, 0);
  assert.equal(image.listeners.size, 0);
});

test('生成 bootstrap は条件起動エンジンを構文有効かつ決定論的に配線する', () => {
  assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'preview-bootstrap.js' }));
  assert.match(bootstrap, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg'/u);
  assert.match(bootstrap, /createElementNS\(ns, 'feGaussianBlur'\)/u);
  assert.match(bootstrap, /createElementNS\(ns, 'feTurbulence'\)/u);
  assert.match(bootstrap, /blur\.setAttribute\('stdDeviation', '0 0'\)/u);
  assert.match(bootstrap, /String\(visual\.blurStdDeviationRatio \* stageWidth\) \+ ' 0'/u);
  assert.match(bootstrap, /blur\.setAttribute\('edgeMode', 'duplicate'\)/u);
  assert.match(bootstrap, /turbulence\.setAttribute\('seed', '7'\)/u);
  assert.match(bootstrap, /dissolveTable\.setAttribute\('type', 'discrete'\)/u);
  assert.match(bootstrap, /transitionDissolveTableValues\(visual\.dissolveVisibleRatio, 256\)/u);
  assert.match(bootstrap, /imageSmoothingEnabled = false/u);
  assert.match(bootstrap, /transitionPixelizeReadyHooks\.arm\(outgoingElement\)/u);
  assert.match(bootstrap, /transitionPixelizeReadyHooks\.arm\(incomingElement\)/u);
  assert.match(bootstrap, /transitionPixelizeReadyHooks\.reset\(\)/u);
  assert.match(bootstrap, /transition-engine-filters'\)\?\.remove\(\)/u);
  assert.match(bootstrap, /transition-pixelize-canvas'\)\?\.remove\(\)/u);

  const staticMarkup = source.slice(
    source.indexOf('<div id="preview-layers">'),
    source.indexOf('<div id="layer-select-box">')
  );
  assert.doesNotMatch(staticMarkup, /transition-engine-filters|transition-pixelize-canvas/u);
});
