import assert from 'node:assert/strict';
import test from 'node:test';

import { renderFixture } from './helpers/cut-audio-supply.mjs';
import { unsplitFixture } from '../../edit-store/test/helpers/cut-audio-supply.mjs';

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades) declares
// fade_in/fade_out for every audio clip, and packages/schemas/engine-capabilities.json already
// lists tracks[].items[].fade_in / fade_out as "projected by buildV2AudioItem, consumed by
// render-cut audio mix". Only bgm and sfx actually honoured it: the narration/speech branch of
// buildV2AudioItem dropped both fields from the compatibility projection, and plan.mjs's
// narration loop never called resolveSfxFadeSeconds -- so a declared fade produced a generated
// command with no afade in it at all (不具合メモ 第20項). This suite runs the whole chain
// (v2 doc -> readRenderEdit projection -> buildPlan) with only the media probe mocked, so it
// fails if either half regresses.

const graph = command => command.args[command.args.indexOf('-filter_complex') + 1];

// at 60 / duration 120 at fps 30 = a 4s narration clip starting at 2s, whose [in, out) window is
// 4s long as well -- long enough for fade_in 1 to stay clear of the effectiveDuration/2 ceiling.
function narrationFixture(patch = {}) {
  const doc = unsplitFixture();
  doc.tracks[1].items = [{
    id: 'narrator', at: 60, duration: 120, role: 'narration', gain_db: -2,
    source: { kind: 'media', src: 'main', in: 0, out: 4 },
    ...patch,
  }];
  return doc;
}

test('narration fade_in/fade_out reach the audio mix command as an afade pair before adelay', () => {
  renderFixture(narrationFixture({ fade_in: 1, fade_out: 0.25 }), 'osr', ({ edit, plan }) => {
    // The compatibility projection must carry both fields in render-cut's snake_case spelling.
    assert.equal(edit.audio.narration[0].fade_in, 1);
    assert.equal(edit.audio.narration[0].fade_out, 0.25);

    const filters = graph(plan.commands.audio_mix);
    assert.match(filters, /afade=t=in:st=0:d=1/);
    // The clip's own window is [2s, 6s), so t=out starts at 4 - 0.25 = 3.75 in clip-local time.
    assert.match(filters, /afade=t=out:st=3\.75:d=0\.25/);
    // Both fades are chained onto the clip's content start -- before adelay -- so st=0 lands on
    // the first narration sample instead of on adelay's leading silence.
    assert.match(
      filters,
      /\[1:a\]atrim=start=0:end=4,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1,afade=t=out:st=3\.75:d=0\.25,volume=-2dB,adelay=2000:all=1\[nar_raw0\]/,
    );
    assert.deepEqual(plan.commands.audio_mix.warnings.filter(warning => warning.includes('fade')), []);
  });
});

test('an undeclared narration fade keeps the mix command free of afade', () => {
  renderFixture(narrationFixture(), 'osr', ({ edit, plan }) => {
    assert.equal('fade_in' in edit.audio.narration[0], false);
    assert.equal('fade_out' in edit.audio.narration[0], false);
    assert.doesNotMatch(graph(plan.commands.audio_mix), /afade=/);
  });
});

test('a narration fade longer than half the clip window is clamped with a warning', () => {
  renderFixture(narrationFixture({ fade_in: 4, fade_out: 4 }), 'osr', ({ plan }) => {
    const filters = graph(plan.commands.audio_mix);
    assert.match(filters, /afade=t=in:st=0:d=2,afade=t=out:st=2:d=2/);
    assert.deepEqual(plan.commands.audio_mix.warnings.filter(warning => warning.includes('fade')), [
      "audio.narration[0].fade_in 4s exceeds half the clip's effective duration (4s); clamped to 2s",
      "audio.narration[0].fade_out 4s exceeds half the clip's effective duration (4s); clamped to 2s",
    ]);
  });
});
