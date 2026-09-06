import { projectLegacyAudioView, projectLegacyEdit, readInternalEdit, projectSpeechDeclarations,
  buildWebAudioSchedule, projectSpeechKeyIntervals } from '../../lib/index.js';
import { prepareFrameEngineAudioSummary } from '../../../preview-server/src/preview-audio-summary.mjs';
import { renderFixture } from '../../../render-cut/test/helpers/cut-audio-supply.mjs';
import { unsplitFixture, decodedAudio, plain, previewAdapter } from './cut-audio-supply.mjs';

// Capture current consumers for comparison with the snapshot recorded from commit 6b40d920.
export function captureUnsplitBaseline() {
  const doc = unsplitFixture();
  const internal = readInternalEdit(doc);
  const legacy = projectLegacyEdit(internal);
  const audio = projectLegacyAudioView(internal);
  const speech = projectSpeechDeclarations(legacy.cuts, { fps: 30 });
  const schedule = buildWebAudioSchedule({ timelineDurationSec: 3, startAtSec: 0,
    audio: { ...decodedAudio(audio), speech: speech.map(item => ({ ...item, materialDurationSec: 12 })) } });
  const result = { legacy, audio, speech, schedule,
    keys: projectSpeechKeyIntervals(legacy.cuts, [{ start: 0, end: 3 }], { fps: 30, sourceId: 'main' }) };
  for (const engine of ['osr', 'gpu']) {
    result[engine] = renderFixture(doc, engine, ({ plan, portable }) => portable(plan.commands));
  }
  result.preview = renderFixture(doc, 'osr', ({ edit }) => {
    const summary = prepareFrameEngineAudioSummary(edit, { projectRoot: '.', cacheDir: '.cache',
      ffmpeg: 'ffmpeg', sourcePathOf: value => value,
      requestSidecar: () => ({ state: 'queued', key: 'fixture-key' }) });
    const client = previewAdapter();
    return { summary, declarations: client.audioDeclarations({ ...edit, audio: summary.audio }),
      speech: client.speechDeclarations({ ...edit, audio: summary.audio }, 30, new Map([['main', { url: '/assets/main.mp4' }]])) };
  });
  return plain(result);
}
