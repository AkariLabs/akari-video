import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const start = source.indexOf('            const scrubSrcForSegment = segment => {');
const end = source.indexOf('            const setScrubAudioEnabled = enabled => {', start);
assert.ok(start >= 0 && end > start);
const wiring = source.slice(start, end);

function fixture() {
  const segments = [
    { kind: 'src', src: 'camera', track: 0, mute: true },
    { kind: 'src', src: 'camera', track: 0, mute: true },
  ];
  const prepared = [];
  const mutedTracksByScope = { cuts: new Set() };
  const allTracksMutedByScope = { cuts: false };
  const functions = new Function('segments', 'mutedTracksByScope', 'allTracksMutedByScope', 'prepared', `
    let globalMuted = false;
    const scrubAudioEnabled = true;
    const isStillSegment = () => false;
    const isCutAudioAudibleFn = (segment, track) => segment.audio !== false && segment.mute !== true && !track.muted;
    const initial = { videoSourceOriginals: { camera: '/original.mp4' } };
    const videoSources = { camera: '/proxy.mp4' };
    const video = { currentSrc: '', getAttribute: () => null };
    const ensureScrubAudio = () => ({ prepare: srcs => prepared.push(srcs) });
    ${wiring}
    return { prepareScrubAudioSources, setGlobalMuted: value => { globalMuted = value; } };
  `)(segments, mutedTracksByScope, allTracksMutedByScope, prepared);
  return { segments, prepared, mutedTracksByScope, allTracksMutedByScope, ...functions };
}

test('全アイテムが mute の素材は prepare せず、解除後に prepare する', () => {
  const state = fixture();
  state.prepareScrubAudioSources();
  assert.deepEqual(state.prepared, []);
  state.segments[0].mute = false;
  state.prepareScrubAudioSources();
  assert.deepEqual(state.prepared, [['/original.mp4']]);
});

test('トラックと全体のミュート中は prepare しない', () => {
  const state = fixture();
  state.segments[0].mute = false;
  state.mutedTracksByScope.cuts.add(0);
  state.prepareScrubAudioSources();
  state.mutedTracksByScope.cuts.clear();
  state.setGlobalMuted(true);
  state.prepareScrubAudioSources();
  assert.deepEqual(state.prepared, []);
  state.setGlobalMuted(false);
  state.prepareScrubAudioSources();
  assert.deepEqual(state.prepared, [['/original.mp4']]);
});
