import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { splitFixture, unsplitFixture, baseline } from '../../edit-store/test/helpers/cut-audio-supply.mjs';
import { renderFixture } from './helpers/cut-audio-supply.mjs';

const graph = command => command.args?.[command.args.indexOf('-filter_complex') + 1] ?? '';
for (const engine of ['gpu', 'osr']) {
  test(`${engine} cut_audio and audio_mix preserve the unsplit baseline arguments`, () => {
    renderFixture(unsplitFixture(), engine, ({ plan, portable }) => {
      assert.deepEqual(portable(plan.commands), baseline()[engine]);
    });
  });

  for (const at of [0, 30]) test(`${engine} split cut at frame ${at} feeds silence to mux and one speech bus to audio_mix`, () => {
    const doc = splitFixture();
    doc.tracks[0].items[0].at = at;
    doc.tracks[1].items[0].at = 60;
    renderFixture(doc, engine, ({ edit, plan }) => {
      assert.equal(edit.cuts.length, 1);
      assert.equal(edit.cuts[0].audio, false);
      assert.equal(edit.cuts[0].mute, true);
      assert.match(graph(plan.commands.cut_audio), /anullsrc/);
      assert.doesNotMatch(graph(plan.commands.cut_audio), /\[\d+:a\]/);
      const mix = plan.commands.audio_mix;
      assert.match(graph(mix), /\[speech\]/);
      assert.match(graph(mix), /adelay=2000:all=1/);
      assert.equal(mix.args.filter(value => value.endsWith('main.mp4')).length, 1);
      assert.equal(mix.envelope.speech_intervals, 1);
      assert.equal(mix.hasAudibleAudio, true);
    });
  });
}

test('render speech duck key follows the audio item after moving/unlinking; cuts cannot re-key it', () => {
  const doc = splitFixture();
  doc.tracks[1].items[0].at = 60;
  doc.tracks[1].items[0].duration = 30;
  doc.tracks[1].items[0].source.in = 1;
  doc.tracks[1].items[0].source.out = 2;
  doc.audio = { duck_keys: ['speech'] };
  doc.tracks[1].items.push({ id: 'bed', role: 'bgm', at: 0, duration: 90, ducking: true,
    source: { kind: 'media', src: 'main', in: 0 } });
  const capture = () => renderFixture(doc, 'osr', ({ plan, portable }) => portable(plan.commands));
  const linked = capture();
  delete doc.tracks[1].items[0].link;
  assert.deepEqual(capture(), linked);
  assert.equal(linked.audio_mix.envelope.speech_intervals, 1);
  assert.deepEqual(linked.audio_mix.envelope.ducked_items, ['bgm']);
  assert.match(graph(linked.audio_mix), /atrim=start=1:end=2/);
});

test('render item mute and audio track mute suppress all audio roles; visual mute leaves split speech audible', () => {
  for (const role of ['speech', 'sfx', 'narration', 'bgm']) {
    for (const muted of [false, true]) for (const mute of [false, true]) {
      const doc = splitFixture();
      doc.tracks[0].muted = true;
      doc.tracks[1].muted = muted;
      Object.assign(doc.tracks[1].items[0], { role, mute });
      renderFixture(doc, 'osr', ({ plan }) => {
        const mix = plan.commands.audio_mix;
        assert.equal(mix.operation, muted || mute ? 'copy' : 'ffmpeg', `${role} ${muted} ${mute}`);
        assert.equal(mix.envelope.speech_intervals, role === 'speech' && !muted && !mute ? 1 : 0);
      });
    }
  }
});

test('both export exits retain the shared cut_audio carrier mux wiring', () => {
  const render = readFileSync(new URL('../src/render-cut.mjs', import.meta.url), 'utf8');
  assert.match(render, /const audioSourcePath = plan.commands.tail_pad_audio \? tailPaddedAudioPath : cutAudioPath/);
  for (const engine of ['gpu', 'osr']) {
    const source = readFileSync(new URL(`../../${engine}-export/src/index.mjs`, import.meta.url), 'utf8');
    assert.match(source, /audioPath: audioSourcePath/);
    assert.doesNotMatch(source, /\.link\b|role\s*===\s*['"]speech/);
  }
});
