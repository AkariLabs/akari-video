import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreviewItemWrite, resolvePreviewItemWriteBatch } from '../lib/edit-v2-item-write.js';

const v2 = () => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'main', path: 'assets/main.mp4' }],
  tracks: [
    {
      id: 'v-main',
      lane: 'visual',
      items: [
        {
          id: 'clip-1',
          at: 0,
          duration: 90,
          source: { kind: 'media', src: 'main', in: 0, out: 3 },
        },
      ],
    },
    {
      id: 'v-html',
      lane: 'visual',
      items: [
        {
          id: 'title-1',
          at: 0,
          duration: 90,
          source: { kind: 'html', path: 'overlays/title.html', vars: { color: 'red' } },
        },
      ],
    },
  ],
});

test('photo crop rotation writes as one crop and transform change', () => {
  const value = v2();
  value.sources[0].path = 'assets/photo.png';
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'layer', itemId: 'clip-1', patch: {
      crop: { x: .1, y: .1, w: .8, h: .8, rotate: 5 },
      transform: { x: 12, y: -5, scale: .5, rotate: 0 }
    }
  });
  const item = JSON.parse(result.candidateText).tracks[0].items[0];
  assert.equal(item.crop.rotate, 5);
  assert.equal(item.transform.x, 12);
});

test('v2 transform patch persists on tracks[].items[].transform', () => {
  const value = v2();
  value.sources.push({ id: 'mask', path: 'assets/mask.mp4' });
  value.tracks[0].items[0].mask = 'mask';
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay',
    itemId: 'title-1',
    patch: { transform: { x: 32, y: -18, scale: 1.25, rotate: 4 } },
  });

  const written = JSON.parse(result.candidateText);
  assert.deepEqual(written.tracks[1].items[0].transform, {
    x: 32,
    y: -18,
    scale: 1.25,
    rotate: 4,
  });
  assert.equal(written.cuts, undefined);
  assert.equal(written.tracks[0].items[0].mask, 'mask');
});

test('dragged visible position removes entrance offset before saving the base value', () => {
  const value = v2();
  const title = value.tracks[1].items[0];
  title.transform = { x: 10, y: 5 };
  title.motion = { in: { preset: 'slide-up', duration: 30, amount: 40 } };
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay', itemId: 'title-1', playheadSeconds: 0,
    patch: { transform: { x: 20, y: 45 } },
  });
  const saved = JSON.parse(result.candidateText).tracks[1].items[0].transform;
  assert.equal(saved.x, 20);
  assert.equal(saved.y, 5);
});

test('dragged keyframed overlay writes only X/Y at the playhead', () => {
  const value = v2();
  const title = value.tracks[1].items[0];
  title.transform = { x: 0, y: 0, scale: .5, rotate: 12 };
  title.keyframes = [{ t: 0, transform: { x: 0, scale: .5 } },
    { t: 60, transform: { x: 100, scale: .75 } }];
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay', itemId: 'title-1', playheadSeconds: 1,
    patch: { transform: { x: 70, y: 0 } },
  });
  const saved = JSON.parse(result.candidateText).tracks[1].items[0];
  assert.deepEqual(saved.transform, title.transform);
  assert.deepEqual(saved.keyframes[1], { t: 30, transform: { x: 70, y: 0 } });
  assert.deepEqual(saved.keyframes[0], title.keyframes[0]);
  assert.deepEqual(saved.keyframes[2], title.keyframes[1]);
});

test('media move writes only position at the playhead and keeps scale and rotation', () => {
  const value = v2();
  const item = value.tracks[0].items[0];
  item.transform = { x: -200, y: 0, scale: .25, rotate: 8 };
  item.keyframes = [{ t: 0, transform: { x: -200 } }, { t: 90, transform: { x: 100 } }];
  const result = resolvePreviewItemWrite(JSON.stringify(value), { kind: 'layer', itemId: item.id,
    playheadSeconds: .5, patch: { transform: { x: -70, y: 0 } } });
  const saved = JSON.parse(result.candidateText).tracks[0].items[0];
  assert.deepEqual(saved.transform, item.transform);
  assert.deepEqual(saved.keyframes.find(point => point.t === 15),
    { t: 15, transform: { x: -70, y: 0 } });
  assert.deepEqual(saved.keyframes[0], item.keyframes[0]);
  assert.deepEqual(saved.keyframes[2], item.keyframes[1]);
});

test('one path write replaces only X/Y inside its span', () => {
  const value = v2();
  const clip = value.tracks[0].items[0];
  clip.keyframes = [
    { t: 0, transform: { x: 1, y: 2 }, opacity: .2 },
    { t: 30, transform: { x: 3, y: 4, rotate: 10 }, opacity: .8 },
    { t: 90, transform: { x: 9, y: 9 } },
  ];
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'cut', itemId: 'clip-1', legacyIndex: 0,
    patch: { xyKeyframes: [{ t: 20, transform: { x: 10, y: 20 } },
      { t: 40, transform: { x: 30, y: 40 } }] },
  });
  const points = JSON.parse(result.candidateText).tracks[0].items[0].keyframes;
  assert.deepEqual(points.map(point => point.t), [0, 20, 30, 40, 90]);
  assert.deepEqual(points[2].transform, { rotate: 10 });
  assert.equal(points[2].opacity, .8);
  assert.deepEqual(points[4].transform, { x: 9, y: 9 });
});

test('one path write also saves HTML, shape, and canvas positions', () => {
  for (const source of [{ kind: 'html', path: 'overlays/title.html' },
    { kind: 'shape', shape: 'ellipse' }, { kind: 'group' }]) {
    const value = v2();
    const item = value.tracks[1].items[0];
    item.source = source;
    if (source.kind === 'group') item.items = [];
    const result = resolvePreviewItemWrite(JSON.stringify(value), {
      kind: 'overlay', itemId: item.id,
      patch: { xyKeyframes: [{ t: 0, transform: { x: 10, y: 20 } },
        { t: 30, transform: { x: 40, y: 50 } }] },
    });
    const saved = JSON.parse(result.candidateText).tracks[1].items[0];
    assert.deepEqual(saved.keyframes.map(point => point.transform),
      [{ x: 10, y: 20 }, { x: 40, y: 50 }]);
  }
});

test('v2 html patch resolves its referenced fragment and never embeds html in edit.json', () => {
  const source = JSON.stringify(v2());
  const htmlOnly = resolvePreviewItemWrite(source, {
    kind: 'overlay',
    itemId: 'title-1',
    patch: { html: '<div>changed</div>' },
  });

  assert.equal(htmlOnly.htmlPath, 'overlays/title.html');
  assert.equal(htmlOnly.candidateText, undefined);

  const withVars = resolvePreviewItemWrite(source, {
    kind: 'overlay',
    itemId: 'title-1',
    patch: { vars: { weight: 700 } },
  });
  const written = JSON.parse(withVars.candidateText);
  assert.deepEqual(written.tracks[1].items[0].source.vars, { color: 'red', weight: 700 });
  assert.equal(written.tracks[1].items[0].html, undefined);
});

test('v2 slot edit merges source.params without returning an html file write', () => {
  const value = v2();
  value.tracks[1].items[0].source.params = { title: '旧タイトル', fixed: '維持' };
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay',
    itemId: 'title-1',
    patch: { params: { title: '<b>文字列のまま</b>' } },
  });

  assert.equal(result.htmlPath, undefined);
  const written = JSON.parse(result.candidateText);
  assert.deepEqual(written.tracks[1].items[0].source.params, {
    title: '<b>文字列のまま</b>',
    fixed: '維持',
  });
});

test('v2 shape overlay accepts the shared transform patch without exposing an HTML file write', () => {
  const value = v2();
  value.tracks[1].items[0] = {
    id: 'shape-1',
    at: 0,
    duration: 90,
    source: { kind: 'shape', shape: 'ellipse' },
  };
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay',
    itemId: 'shape-1',
    patch: { transform: { x: 40, y: 20, scale: 0.5 } },
  });

  assert.equal(result.htmlPath, undefined);
  const written = JSON.parse(result.candidateText);
  assert.deepEqual(written.tracks[1].items[0].transform, { x: 40, y: 20, scale: 0.5 });
  assert.deepEqual(written.tracks[1].items[0].source, { kind: 'shape', shape: 'ellipse' });
});

test('v2 shape overlay rejects HTML-specific writes', () => {
  const value = v2();
  value.tracks[1].items[0] = {
    id: 'shape-1', at: 0, duration: 90, source: { kind: 'shape', shape: 'rect' },
  };
  assert.throws(() => resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay', itemId: 'shape-1', patch: { html: '<svg></svg>' },
  }), /図形アイテムには/);
});

test('legacy v0/v1 documents stay on their existing collection route', () => {
  const legacyOverlay = {
    version: 1,
    overlays: [
      { id: 'legacy-title', html: 'overlays/legacy.html', transform: { x: 1 } },
    ],
  };
  const result = resolvePreviewItemWrite(JSON.stringify(legacyOverlay), {
    kind: 'overlay',
    itemId: 'legacy-title',
    patch: { transform: { y: 2 }, html: '<div>legacy</div>' },
  });

  const written = JSON.parse(result.candidateText);
  assert.equal(result.htmlPath, 'overlays/legacy.html');
  assert.deepEqual(written.overlays[0].transform, { x: 1, y: 2 });
  assert.equal(written.tracks, undefined);

  assert.throws(
    () => resolvePreviewItemWrite(JSON.stringify({ version: 1, tracks: [] }), {
      kind: 'overlay',
      itemId: 'legacy-title',
      patch: { transform: { x: 9 } },
    }),
    /overlays が配列ではありません/,
  );
});

test('single move and uniform resize preserve the legacy transform key set', () => {
  const value = v2();
  value.tracks[1].items[0].transform = { x: 0, y: 0, scale: 1, rotate: 0 };
  const move = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay', itemId: 'title-1',
    patch: { transform: { x: 34, y: 19.18, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 } },
  });
  const moved = JSON.parse(move.candidateText).tracks[1].items[0].transform;
  assert.deepEqual(moved, { x: 34, y: 19.18, scale: 1, rotate: 0 });
  assert.deepEqual(Object.keys(moved), ['x', 'y', 'scale', 'rotate']);
  const resize = resolvePreviewItemWrite(move.candidateText, {
    kind: 'overlay', itemId: 'title-1',
    patch: { transform: { x: 34, y: 19.18, scale: 1.5, scaleX: 1.5, scaleY: 1.5, rotate: 0 } },
  });
  assert.deepEqual(JSON.parse(resize.candidateText).tracks[1].items[0].transform,
    { x: 34, y: 19.18, scale: 1.5, rotate: 0 });
});

test('single move keeps the declared axes; an explicit resize folds equality', () => {
  const value = v2();
  value.tracks[1].items[0].transform = { x: 0, y: 0, scale: 1, scaleX: 2, rotate: 0 };
  const move = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'overlay', itemId: 'title-1', patch: { transform: { x: 5, y: 6 } },
  });
  const moved = JSON.parse(move.candidateText).tracks[1].items[0].transform;
  assert.deepEqual(moved, { x: 5, y: 6, scale: 1, scaleX: 2, rotate: 0 });
  assert.deepEqual(Object.keys(moved), ['x', 'y', 'scale', 'scaleX', 'rotate']);
  const equal = resolvePreviewItemWrite(move.candidateText, {
    kind: 'overlay', itemId: 'title-1', patch: { transform: { scaleX: 1, scaleY: 1 } },
  });
  assert.deepEqual(JSON.parse(equal.candidateText).tracks[1].items[0].transform,
    { x: 5, y: 6, scale: 1, rotate: 0 });
});

test('batch move preserves each item’s original scale representation', () => {
  const value = v2();
  value.tracks[0].items[0].transform = { x: 0, y: 0, scale: 1, rotate: 0 };
  value.tracks[1].items[0].transform = { x: 0, y: 0, scale: 1, scaleX: 2, scaleY: 0.5, rotate: 0 };
  const result = resolvePreviewItemWriteBatch(JSON.stringify(value), [
    { kind: 'cut', itemId: 'clip-1', legacyIndex: 0, patch: { transform: { x: 10, y: 20 } } },
    { kind: 'overlay', itemId: 'title-1', patch: { transform: { x: 30, y: 40 } } },
  ]);
  const written = JSON.parse(result.candidateText);
  assert.deepEqual(written.tracks[0].items[0].transform, { x: 10, y: 20, scale: 1, rotate: 0 });
  assert.deepEqual(written.tracks[1].items[0].transform,
    { x: 30, y: 40, scale: 1, scaleX: 2, scaleY: 0.5, rotate: 0 });
});
