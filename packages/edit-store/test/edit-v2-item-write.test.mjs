import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';

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
