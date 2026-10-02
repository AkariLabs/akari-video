import assert from 'node:assert/strict';
import test from 'node:test';

import { captionEdgeHandleLayout } from '../lib/common/caption-edge-handle-layout.js';
import { captionWrapResize } from '../lib/common/caption-edit-geometry.js';
import { captionWrapPosition } from '../lib/common/caption-wrap-position.js';
import { persistCaptionPlateTransform } from '../lib/common/caption-plate-handles.js';
import { previewSelectionHandlesStyle } from '../lib/browser/preview-selection-handles-style.js';
import { renderCaptionFragment, renderResolvedSingleLineCaption,
  renderStyledCaptionFragment, generateCaptionOverlays,
  generateResolvedCaptionOverlays } from '../../../../../packages/render-cut/src/captions.mjs';
import { readHandlerSource, sliceBetween } from './helpers/handler-source.mjs';

const handler = readHandlerSource();

test('R1 speech captions expose both edge grips and persist width with fixed-side position in one write', async () => {
  const handles = sliceBetween('const applyCaptionSelectionAttrs =', 'const setCaptionAltAll =');
  const drag = sliceBetween('const beginCaptionHandleDrag =', 'const onCaptionPointerDown =');
  assert.match(handles, /\['nw', 'ne', 'sw', 'se', 'e', 'w', 'rot', 'move'\]/u);
  assert.doesNotMatch(handles, /timeDomain/u);
  assert.doesNotMatch(drag, /caption\.timeDomain\s*!==\s*'output'/u);
  assert.match(drag, /patch = \{ wrapWidthPct: wrap\.widthPct,[\s\S]*?cuePosition:/u);
  assert.match(handler, /kind: 'caption-wrap', captionId: request\.captionId,[\s\S]*?wrapWidthPct: patch\.wrapWidthPct, anchor: position\.anchor,[\s\S]*?position: position\.position/u);

  const wrap = captionWrapResize('w', { left: 200, right: 800, top: 100, bottom: 140 },
    { x: 100, y: 0 }, 0, 1, 1920);
  assert.equal(wrap.left + wrap.widthPct / 100 * 1920, 800);
  const position = captionWrapPosition(wrap.left, 100, 1920, 1080);
  const source = JSON.stringify({ captions: [{ id: 'speech', sourceRef: { source: 'source.mp4' },
    text: '話した言葉', text_style: { size_px: 28 } }] });
  let writes = 0;
  let saved;
  const result = await persistCaptionPlateTransform({ source, captionIds: ['speech'],
    patch: { wrapWidthPct: wrap.widthPct }, cuePosition: { captionId: 'speech', value: position },
    lint: async () => ({ pass: true, errors: [] }),
    write: async next => { writes++; saved = JSON.parse(next); } });
  assert.equal(result.pass, true);
  assert.equal(writes, 1);
  assert.equal(saved.captions[0].text_style.wrap_width_pct, wrap.widthPct);
  assert.equal(saved.captions[0].text_style.text_anchor, 'tl');
  assert.deepEqual(saved.captions[0].text_style.position, position.position);
  assert.deepEqual(saved.captions[0].sourceRef, { source: 'source.mp4' });
});

test('R2 full-height edge grips avoid corner circles at 10, 19.6, 30 and 103 px through zoom and rotation', () => {
  assert.match(handler, /captionEdgeHandleLayoutFn\(captionSelectBox\.offsetHeight \* chromeScaleY\)/u);
  assert.match(handler, /edgeLayout\.edgeOutset \/ chromeScaleX/u);
  assert.match(previewSelectionHandlesStyle, /var\(--akari-caption-edge-outset,0px\)/u);
  assert.ok(handler.includes('width:11px;height:20px'));
  assert.ok(handler.includes('width:5px;height:14px'));
  assert.match(previewSelectionHandlesStyle, /\[data-h="nw"\] \{ left: 0; top: 0;/u);
  assert.match(previewSelectionHandlesStyle, /\[data-h="se"\] \{ right: 0; bottom: 0;/u);
  const polygon = (centerX, centerY, width, height, sx, sy, angle) => {
    const theta = angle * Math.PI / 180;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ix, iy]) => {
      const x = centerX + ix * width / (2 * sx);
      const y = centerY + iy * height / (2 * sy);
      return { x: sx * (x * Math.cos(theta) - y * Math.sin(theta)),
        y: sy * (x * Math.sin(theta) + y * Math.cos(theta)) };
    });
  };
  const overlaps = (a, b) => {
    for (const shape of [a, b]) for (let i = 0; i < shape.length; i++) {
      const p = shape[i], q = shape[(i + 1) % shape.length];
      const axis = { x: q.y - p.y, y: p.x - q.x };
      const project = points => points.map(point => point.x * axis.x + point.y * axis.y);
      const ap = project(a), bp = project(b);
      if (Math.max(...ap) <= Math.min(...bp) || Math.max(...bp) <= Math.min(...ap)) return false;
    }
    return true;
  };
  for (const height of [10, 19.6, 30, 103]) {
    const { edgeOutset } = captionEdgeHandleLayout(height);
    assert.equal(edgeOutset, height === 103 ? 0 : 18);
    assert.ok(edgeOutset <= 20);
    for (const [sx, sy] of [[.25, .25], [1, 1], [2, 2], [.5, .6]]) {
      for (const angle of [0, 30, 90]) {
        const boxWidth = 200 / sx, boxHeight = height / sy;
        for (const [side, x] of [['w', -edgeOutset / sx], ['e', boxWidth + edgeOutset / sx]]) {
          const edge = polygon(x, boxHeight / 2, 11, 20, sx, sy, angle);
          for (const cornerX of [0, boxWidth]) for (const cornerY of [0, boxHeight]) {
            const corner = polygon(cornerX, cornerY, 11, 11, sx, sy, angle);
            assert.equal(overlaps(edge, corner), false,
              `${side} collision at ${height}px, scale ${sx}/${sy}, angle ${angle}`);
          }
        }
      }
    }
  }
});

test('R3 speech and output captions consume the same preview wrap width rule', () => {
  assert.match(previewSelectionHandlesStyle,
    /\.caption-row-plate\[data-output-caption\]\[style\*="--caption-wrap-width"\] \.akari-caption__plate \{ width: var\(--caption-wrap-width\); \}/u);
  assert.match(previewSelectionHandlesStyle,
    /\.caption-row-plate:not\(\[data-output-caption\]\)\[style\*="--caption-wrap-width"\] \.akari-caption__plate \{ width: var\(--caption-wrap-width\); \}/u);
  assert.match(previewSelectionHandlesStyle,
    /\.caption-row-plate:not\(\[data-output-caption\]\)\[style\*="--caption-wrap-width"\] \.akari-caption__line,[\s\S]*?white-space: pre-wrap; overflow-wrap: anywhere/u);
});

test('R4 OSR emits wrap CSS for unscaled plain, styled and resolved captions only when width is set', () => {
  const words = [{ text: '長い字幕', start: 0, end: 1, line: 0 }];
  const cases = [
    [renderCaptionFragment('長い字幕', { sizeToInk: false }),
      renderCaptionFragment('長い字幕', { sizeToInk: false, wrapWidth: 25 })],
    [renderStyledCaptionFragment(words, 'karaoke', { sizeToInk: false }),
      renderStyledCaptionFragment(words, 'karaoke', { sizeToInk: false, wrapWidth: 25 })],
    [renderResolvedSingleLineCaption('長い字幕', ['長い字幕'], { style_vars: {} }),
      renderResolvedSingleLineCaption('長い字幕', ['長い字幕'],
        { style_vars: { '--caption-wrap-width': '25%' } })],
  ];
  for (const [without, withWidth] of cases) {
    assert.doesNotMatch(without, /width: var\(--caption-wrap-width\)/u);
    assert.match(withWidth, /width: var\(--caption-wrap-width\)/u);
    assert.match(withWidth, /white-space: pre-wrap; overflow-wrap: anywhere/u);
    assert.equal(without, withWidth.replace(/    (?:\.akari-caption--single-line )?\.akari-caption__plate \{ width: var\(--caption-wrap-width\); \}\n?\s*(?:\.akari-caption--single-line )?\.akari-caption__plate \{ margin-inline: var\(--caption-plate-margin, auto\); \}\n?\s*(?:\.akari-caption--single-line )?\.akari-caption__line(?:, \.akari-caption__block)? \{[^}]+\}\n?/u, ''));
  }
});

test('R5 preview and OSR keep center, left, right and explicit-x placement with wrap width', () => {
  assert.match(previewSelectionHandlesStyle,
    /\.caption-row-plate\[style\*="--caption-wrap-width"\] \.akari-caption__plate \{ right: var\(--caption-right,0\); margin-inline: var\(--caption-plate-margin,auto\)/u);
  assert.match(handler, /wrapWidthActive[\s\S]*?captionHorizontal[\s\S]*?Number\.isFinite\(captionPositionX\) \? '0'[\s\S]*?'0 auto'[\s\S]*?'auto 0' : 'auto'/u);
  const cases = [
    ['center', { zone: 'bottom' }, 'auto', 720],
    ['left', { text_anchor: 'tl', position: { y: .2 } }, '0 auto', 76.8],
    ['right', { text_anchor: 'tr', position: { y: .2 } }, 'auto 0', 1363.2],
    ['zone-left', { zone: 'top-left' }, '0 auto', 76.8],
    ['zone-right', { zone: 'bottom-right' }, 'auto 0', 1363.2],
    ['explicit-x', { text_anchor: 'tl', position: { x: .3, y: .2 } }, '0', 576],
  ];
  for (const [name, placement, margin, expectedLeft] of cases) {
    const textStyle = { ...placement, wrap_width_pct: 25 };
    const [overlay] = generateCaptionOverlays([{ id: name, start: 0, end: 2,
      text: '折り返し幅を付けた文字', text_style: textStyle }], [], { width: 1920, height: 1080 });
    const [resolved] = generateResolvedCaptionOverlays({ display_cues: [{ id: name, start: 0, end: 2,
      text: '折り返し幅を付けた文字', display_lines: ['折り返し幅を付けた文字'], source_cue_id: name,
      text_style: textStyle, style_vars: overlay.vars }] });
    const expectedVar = margin === 'auto' ? undefined : margin;
    assert.equal(overlay.vars['--caption-plate-margin'], expectedVar, name);
    assert.equal(resolved.vars['--caption-plate-margin'], expectedVar, `${name} resolved`);
    for (const html of [overlay.html, resolved.html]) {
      assert.match(html, /width: var\(--caption-wrap-width\)/u);
      assert.match(html, /margin-inline: var\(--caption-plate-margin, auto\)/u);
    }
    const left = Number.parseFloat(overlay.vars['--caption-left'] ?? '0') / 100 * 1920;
    const right = Number.parseFloat(overlay.vars['--caption-right'] ?? '0') / 100 * 1920;
    const width = 1920 * .25;
    const positionedLeft = margin === 'auto' ? left + (1920 - left - right - width) / 2
      : margin === 'auto 0' ? 1920 - right - width : left;
    assert.ok(Math.abs(positionedLeft - expectedLeft) < .01, name);
  }
});
