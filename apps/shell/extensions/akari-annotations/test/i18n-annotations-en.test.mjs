import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { setLanguage, t } from '@akari-video/i18n';
import { readFileSync } from 'node:fs';

setLanguage('en');
after(() => setLanguage(undefined));

const { readAloudPrice, readAloudProvenanceLabel } = await import('../lib/common/read-aloud-model.js');
const { voiceCheckReason, geminiWatermarkNotice } = await import('../lib/common/voice-clone-model.js');
const { timelineEmptyStateMessage } = await import('../lib/common/timeline-empty-state.js');
const { canvasOperationReason } = await import('../lib/common/canvas-operation-reason.js');
const { itemMotionMarks } = await import('../lib/browser/inspector/motion-marks.js');
const { buildGenerationBatch, executeGenerationBatch, generationBatchProgressLabel } = await import('../lib/browser/inspector/generation-batch.js');
const { aiActionCatalog } = await import('../lib/common/ai-action-catalog.js');
const { availableActions } = await import('../lib/common/task-actions.js');
const { shapeClipLabel } = await import('../lib/common/timeline-clip-face.js');
const { planCompileHandoff } = await import('../lib/common/compile-session-handoff.js');
const { materialDropDecision } = await import('../lib/common/timeline-material-insert.js');
const { preparePhotoClick } = await import('../lib/node/photo-segmentation.js');

test('all migrated catalog entries resolve to English', () => {
  for (const namespace of ['inspector', 'annotationscommon', 'lint']) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../../../packages/i18n/locales/en/${namespace}.json`, import.meta.url), 'utf8'));
    for (const key of Object.keys(catalog)) {
      const message = t(key);
      assert.equal(message, catalog[key], key);
      assert.doesNotMatch(message, /[\u3040-\u30ff\u3400-\u9fff]/u, key);
    }
  }
});

test('inspector labels and generation badges use English', () => {
  assert.equal(t('inspector.aiMaterialView.kind.image'), 'Image asset');
  const { rows } = buildGenerationBatch([{ itemId: 'audio', name: 'Audio', start: 0, duration: 1, visual: false }]);
  assert.doesNotMatch(rows[0].badge, /[\u3040-\u30ff\u3400-\u9fff]/u);
  assert.equal(itemMotionMarks({ keyframes: [{ x: 1 }] }, 'x')[0], 'Keyframe');
  assert.equal(generationBatchProgressLabel('generating'), 'Generating…');
});

test('narration and voice copy models use English', () => {
  assert.equal(readAloudPrice({ place: 'local' }), 'Free');
  assert.equal(readAloudProvenanceLabel({ voice: 'profile:p' }, [{ id: 'p', label: 'Sample' }]), 'My voice (Sample)');
  assert.equal(voiceCheckReason(), 'Check the recording.');
  assert.equal(geminiWatermarkNotice(), 'Google adds a watermark to the voice copy.');
});

test('timeline and canvas guidance use English while matching source errors', () => {
  assert.equal(timelineEmptyStateMessage(false), 'Drag assets here or ask your partner to get started.');
  assert.equal(canvasOperationReason(new Error('ロックされた項目')), 'Unlock before continuing.');
});

test('shared action models use English', () => {
  assert.equal(aiActionCatalog([])[0].label, 'Still image');
  assert.deepEqual(availableActions({ state: 'unsent' }).map(action => action.label), ['Send', 'Dismiss']);
  assert.equal(shapeClipLabel({ id: 'shape', source: { shape: 'rect' } }), 'Rectangle');
  assert.equal(planCompileHandoff([]).notice, 'No recordings yet. Record one first.');
  assert.equal(materialDropDecision('audio', 'cuts').reason, 'Drop audio onto an audio track.');
});

test('backend guidance returned to the panel uses English', async () => {
  assert.deepEqual(await preparePhotoClick('/unused', undefined),
    { ok: false, message: 'Background removal is available only on Mac.' });
});

test('generation batch keeps state values stable in English', async () => {
  const states = [];
  await executeGenerationBatch({
    rows: [{ itemId: 'frame', start: 0, eligible: true }],
    projectRootUri: '/project', approved: true,
    start: async () => 'job', wait: async () => ({ ok: true }), stopped: () => false,
    progress: (_itemId, state) => states.push(state)
  });
  assert.deepEqual(states, ['待ち', '生成中', '完了']);
  assert.equal(generationBatchProgressLabel('generating'), 'Generating…');
});
