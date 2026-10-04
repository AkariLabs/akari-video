import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptionContextField } from '../lib/common/caption-context-edit.js';

const stage = { left: 0, top: 0, width: 1920, height: 1080 };

async function toggle(source, enabled, box, options = {}) {
  let written = source;
  const history = [];
  await applyCaptionContextField('a', 'vertical', { enabled, box,
    stage: options.stage ?? stage, outputHeight: options.outputHeight }, [], {
    readSource: async () => written,
    writeSource: async next => { written = next; },
    recordHistory: entry => history.push(entry),
    reload: async () => undefined
  });
  return { style: JSON.parse(written).captions[0].text_style, history };
}

test('wrap length compensates the plate padding when writing direction changes', async () => {
  const source = JSON.stringify({ captions: [{ id: 'a', text_style: {
    wrap_width_pct: 30, text_anchor: 'tl', position: { x: .2, y: .3 } } }] });
  const vertical = await toggle(source, true, { left: 200, top: 200, width: 576, height: 100 });
  assert.equal(vertical.style.wrap_width_pct, 50.94);
  const horizontal = await toggle(JSON.stringify({ captions: [{ id: 'a', text_style: vertical.style }] }),
    false, { left: 200, top: 200, width: 100, height: 576 });
  assert.equal(horizontal.style.wrap_width_pct, 30);
  assert.equal(vertical.history.length, 1);
});

test('wrapped multi-line text keeps the same center across three toggle cycles', async () => {
  const measuredStage = { left: 0, top: 0, width: 627, height: 353 };
  const outputHeight = 1080;
  const fontSize = 52;
  for (const background of [undefined, { mode: 'block' }]) {
    const paddingDelta = background ? 0 : .68 * fontSize * measuredStage.height / outputHeight;
    let style = { wrap_width_pct: 30, size_px: fontSize, scale: 1,
      text_anchor: 'tl', position: { x: 150 / measuredStage.width, y: 120 / measuredStage.height },
      ...(background ? { background } : {}) };
    let box = { left: 150, top: 120, width: .3 * measuredStage.width, height: 51 };
    const originalCenter = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    for (let index = 0; index < 6; index++) {
      const enabled = index % 2 === 0;
      const expectedLength = (enabled ? box.width : box.height) / style.scale
        + (enabled ? -paddingDelta : paddingDelta);
      const source = JSON.stringify({ captions: [{ id: 'a', text: '一行目\n二行目', text_style: style }] });
      const result = await toggle(source, enabled, box, { stage: measuredStage, outputHeight });
      style = result.style;
      const actualLength = style.wrap_width_pct / 100
        * (enabled ? measuredStage.height : measuredStage.width);
      const tolerance = (enabled ? measuredStage.height : measuredStage.width) * .00005 + .001;
      assert.ok(Math.abs(actualLength - expectedLength) <= tolerance,
        `${background ? 'symmetric' : 'plain'} toggle ${index + 1}: ${actualLength} vs ${expectedLength}`);
      const width = enabled ? box.height + paddingDelta : actualLength;
      const height = enabled ? actualLength : box.width - paddingDelta;
      box = { left: style.position.x * measuredStage.width,
        top: style.position.y * measuredStage.height, width, height };
      const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      assert.ok(Math.abs(center.x - originalCenter.x) <= .5,
        `${background ? 'symmetric' : 'plain'} toggle ${index + 1} x center`);
      assert.ok(Math.abs(center.y - originalCenter.y) <= .5,
        `${background ? 'symmetric' : 'plain'} toggle ${index + 1} y center`);
    }
  }
});

test('wrap conversion clamps extremes and leaves captions without a wrap untouched', async () => {
  for (const [pct, enabled, expected] of [[2, true, 8], [95, true, 100], [8, false, 8]]) {
    const source = JSON.stringify({ captions: [{ id: 'a', text_style: { wrap_width_pct: pct } }] });
    const result = await toggle(source, enabled, { left: 100, top: 100, width: 200, height: 100 });
    assert.equal(result.style.wrap_width_pct, expected);
  }
  const result = await toggle(JSON.stringify({ captions: [{ id: 'a', text_style: {} }] }),
    true, { left: 100, top: 100, width: 200, height: 100 });
  assert.equal(Object.hasOwn(result.style, 'wrap_width_pct'), false);
});

test('a wrapped multi-line caption keeps its center through both direction changes', async () => {
  const source = JSON.stringify({ captions: [{ id: 'a', text: '一行目\n二行目', text_style: {
    wrap_width_pct: 30, text_anchor: 'tl', position: { x: .3, y: .4 },
    background: { mode: 'block' } } }] });
  const first = { left: 400, top: 300, width: 576, height: 120 };
  const vertical = await toggle(source, true, first);
  const second = { left: first.left + (first.width - first.height) / 2,
    top: first.top + (first.height - first.width) / 2,
    width: first.height, height: first.width };
  const horizontal = await toggle(JSON.stringify({ captions: [{ id: 'a', text: '一行目\n二行目',
    text_style: vertical.style }] }), false, second);
  const center = (style, box) => ({
    x: style.position.x * stage.width + box.width / 2,
    y: style.position.y * stage.height + box.height / 2
  });
  const before = { x: first.left + first.width / 2, y: first.top + first.height / 2 };
  const afterVertical = center(vertical.style, second);
  const afterHorizontal = center(horizontal.style, first);
  assert.ok(Math.abs(before.x - afterVertical.x) <= 1);
  assert.ok(Math.abs(before.y - afterVertical.y) <= 1);
  assert.ok(Math.abs(before.x - afterHorizontal.x) <= 1);
  assert.ok(Math.abs(before.y - afterHorizontal.y) <= 1);
});
