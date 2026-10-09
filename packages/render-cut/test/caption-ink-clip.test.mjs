import assert from 'node:assert/strict';
import test from 'node:test';
import { captionInkClipRecipe, setCaptionInkClipVariables } from '../src/caption-ink-clip.mjs';
import { CAPTION_ANIMATION_RECIPES, buildCaptionAnimation, renderCaptionFragment } from '../src/captions.mjs';
import { renderOverlaySheet } from '../src/rasterize.mjs';

test('wipe・push・glitch は行の実寸を基準に clip する', () => {
  for (const [id, recipe] of Object.entries(CAPTION_ANIMATION_RECIPES)) {
    for (const [, values] of recipe.matchAll(/clip-path:\s*inset\(([^()]*)\)/gu)) {
      for (const value of values.trim().split(/\s+/u)) {
        assert.ok([0, 10, 20, 30, 45, 60, 100].includes(Number.parseFloat(value)), `${id}: ${value}`);
      }
    }
  }
  for (const id of ['wipe-left', 'wipe-right', 'push-left', 'push-right', 'push-up', 'push-down', 'glitch']) {
    const css = buildCaptionAnimation({ in: { id } }, 2);
    assert.equal(css.hasInkClip, true, id);
    assert.match(css.keyframesCss, /clip-path: inset\(var\(--akari-ink-/u, id);
    assert.match(renderCaptionFragment('短い字幕', { captionAnimation: css }),
      /<div class="akari-caption__plate" data-akari-ink-clip>/u, id);
  }
  assert.match(captionInkClipRecipe('from { clip-path: inset(0 100% 0 0); }'),
    /var\(--akari-ink-right-100, 100%\)/u);
  const values = new Map();
  const style = {
    getPropertyValue: name => values.get(name)?.value ?? '',
    getPropertyPriority: name => values.get(name)?.priority ?? '',
    setProperty: (name, value, priority = '') => values.set(name, { value, priority }),
    removeProperty: name => values.delete(name)
  };
  const line = { getBoundingClientRect: () => ({ left: 400, right: 600, top: 20, bottom: 60 }) };
  const plate = { style, querySelector: () => null,
    querySelectorAll: () => [line],
    getBoundingClientRect: () => ({ left: 0, right: 1000, top: 0, bottom: 100, width: 1000, height: 100 }) };
  style.setProperty('animation', 'akari-anim-wipe-right 1s paused');
  setCaptionInkClipVariables(plate);
  assert.equal(style.getPropertyValue('animation'), 'akari-anim-wipe-right 1s paused');
  assert.equal(style.getPropertyValue('--akari-ink-right-100'), '600px');
  assert.equal(style.getPropertyValue('--akari-ink-right-0'), '400px');
  assert.equal(style.getPropertyValue('--akari-ink-top-60'), '44px');
});

test('OSR sheet measures ink before cloning CSS animations only for clipped captions', () => {
  const caption = renderCaptionFragment('短い字幕', {
    captionAnimation: buildCaptionAnimation({ in: { id: 'wipe-right' } }, 2)
  });
  const sheet = html => renderOverlaySheet({ overlays: [{ id: 'caption', start: 0, duration: 2, html }],
    edit: { output: { width: 640, height: 360, fps: 30 } }, projectRoot: process.cwd(), duration: 2 });
  const clipped = sheet(caption);
  assert.match(clipped, /const setCaptionInkClipVariables = /u);
  assert.ok(clipped.indexOf('setCaptionInkClipVariables(plate)')
    < clipped.indexOf('for (const animation of container.getAnimations'));
  assert.doesNotMatch(sheet('<div>static</div>'), /setCaptionInkClipVariables/u);
});
