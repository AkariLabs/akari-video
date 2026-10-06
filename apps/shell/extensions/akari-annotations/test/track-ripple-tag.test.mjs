import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { resolveTrackRippleMode } from '@akari-video/edit-store';
import {
  applyTrackRipplePreset, cycleTrackRippleMode, nextRippleMode, rippleSwitchValues, rippleTagPresentation,
  setTrackRippleSwitch,
} from '../lib/common/track-ripple-tag.js';

const item = (id, role) => ({ id, role, at: 0, duration: 30, source: { kind: 'media', src: 'source', in: 0, out: 1 } });
const fixture = () => ({ version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [], tracks: [
  { id: 'main', lane: 'visual', items: [item('v')] },
  { id: 'sfx', lane: 'audio', items: [item('s', 'sfx')] },
  { id: 'bgm', lane: 'audio', items: [item('b', 'bgm')] },
  { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
] });

test('mode, lock, row kind and height determine one visible control', () => {
  for (const [mode, label, icon] of [
    ['cut', '切る', 'codicon-fold'], ['shift', 'ずらす', 'codicon-arrow-left'], ['fixed', '固定', 'codicon-pin'],
  ]) {
    for (const height of [40, 60, 240, 720]) {
      const normal = rippleTagPresentation(mode, false, 'track', height);
      assert.equal(normal.label, label);
      assert.equal(normal.icon, icon);
      assert.equal(normal.compact, false);
      assert.equal(normal.placement, 'second');
      assert.match(normal.title, new RegExp(label));
    }
    for (const height of [12, 20, 39]) {
      const small = rippleTagPresentation(mode, false, 'track', height);
      assert.equal(small.compact, true);
      assert.equal(small.placement, 'inline');
    }
    const locked = rippleTagPresentation(mode, true, 'track', 48);
    assert.equal(locked.label, '固定');
    assert.equal(locked.icon, 'codicon-pin');
    assert.equal(locked.disabled, true);
  }
  for (const [height, placement] of [[20, 'inline'], [40, 'second'], [240, 'second']]) {
    const caption = rippleTagPresentation('cut', false, 'caption', height);
    assert.equal(caption.kind, 'follow');
    assert.equal(caption.icon, 'codicon-type-hierarchy-sub');
    assert.equal(caption.label, '本編について動く');
    assert.equal(caption.placement, placement);
  }
});

test('track ripple icons are present in the bundled codicon font', () => {
  const require = createRequire(import.meta.url);
  const css = readFileSync(require.resolve('@vscode/codicons/dist/codicon.css'), 'utf8');
  const sources = [
    new URL('../src/common/track-ripple-tag.ts', import.meta.url),
    new URL('../src/browser/timeline/track-ripple-tag.ts', import.meta.url),
  ].map(url => readFileSync(url, 'utf8')).join('\n');
  const names = new Set([...sources.matchAll(/\bcodicon-([a-z0-9-]+)\b/g)].map(match => match[1]));
  assert(names.size >= 6, 'tag, switches, follow and menu icons are covered');
  for (const name of names) {
    assert(css.includes(`.codicon-${name}:before`), `missing bundled codicon: ${name}`);
  }
});

test('click cycle starts at resolved BGM default and writes explicit pairs', () => {
  let edit = fixture();
  let mode = resolveTrackRippleMode(edit.tracks[2]);
  assert.equal(mode, 'fixed');
  for (const [next, target, sync] of [['cut', true, true], ['shift', false, true], ['fixed', false, false]]) {
    mode = nextRippleMode(mode);
    assert.equal(mode, next);
    edit = cycleTrackRippleMode(edit, 'bgm');
    assert.deepEqual([edit.tracks[2].target, edit.tracks[2].sync], [target, sync]);
  }
});

test('batch choices write one complete new edit and defaults remove only stored flags', () => {
  const original = fixture();
  const originalBytes = JSON.stringify(original);
  const all = applyTrackRipplePreset(original, 'all-cut');
  for (const track of all.tracks.slice(0, 3)) assert.deepEqual([track.target, track.sync], [true, true]);
  assert.equal(all.tracks[3].target, undefined);
  const selected = applyTrackRipplePreset(original, 'selected-cut', ['main']);
  assert.deepEqual(selected.tracks.slice(0, 3).map(track => [track.target, track.sync]),
    [[true, true], [false, false], [false, false]]);
  const defaults = applyTrackRipplePreset(selected, 'defaults');
  assert.equal(JSON.stringify(defaults), originalBytes);
  assert.equal(JSON.stringify(original), originalBytes);
  assert.deepEqual(original.tracks.slice(0, 3).map(resolveTrackRippleMode), ['cut', 'cut', 'fixed']);
});

test('switches independently write target and sync and resolve to shift', () => {
  const original = fixture();
  const targetOff = setTrackRippleSwitch(original, 'main', 'target', false);
  assert.deepEqual([targetOff.tracks[0].target, targetOff.tracks[0].sync], [false, true]);
  const syncOn = setTrackRippleSwitch(targetOff, 'main', 'sync', true);
  assert.deepEqual(rippleSwitchValues(syncOn.tracks[0]), { target: false, sync: true });
  assert.equal(resolveTrackRippleMode(syncOn.tracks[0]), 'shift');
  assert.equal(original.tracks[0].target, undefined);
  assert.equal(original.tracks[0].sync, undefined);
});

test('reading tags and switches leaves edit.json bytes unchanged', () => {
  const edit = fixture();
  const before = Buffer.from(JSON.stringify(edit));
  for (const track of edit.tracks) {
    const mode = resolveTrackRippleMode(track);
    rippleTagPresentation(mode, false, 'content' in track ? 'caption' : 'track', 20);
    rippleSwitchValues(track);
  }
  assert.deepEqual(Buffer.from(JSON.stringify(edit)), before);
});
