import assert from 'node:assert/strict';
import test from 'node:test';
import { planTemplateExport } from '../src/template-export.mjs';

const edit = { version: 2, output: { fps: 30, width: 1080, height: 1920 }, sources: [{ id: 'src-1', path: 'assets/still/image.png' }],
  tracks: [{ lane: 'visual', items: [{ id: 'group', at: 0, duration: 30,
    source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } }, items: [
      { id: 'image', at: 0, duration: 30, source: { kind: 'media', src: 'src-1', in: 0, out: 1 } },
      { id: 'slot', at: 0, duration: 30, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed', intent: 'Main' } }, items: [] }
    ] }] }] };

test('template export resolves source paths and slots', () => {
  const plan = planTemplateExport(edit, 'group', { 'assets/still/image.png': { source: 'own', license: 'CC0-1.0' } });
  assert.equal(plan.fragment.items[0].source.src, 'template/media/image.png');
  assert.equal(plan.slots[0].item, 'slot');
});
test('unknown license and site media stop export', () => {
  assert.throws(() => planTemplateExport(edit, 'group', {}), /image.png/);
  assert.equal(planTemplateExport(edit, 'group', {}, { licenseOwn: 'CC0-1.0' }).media[0].source, 'own');
  assert.throws(() => planTemplateExport(edit, 'group', { 'assets/still/image.png': { source: 'site', license: 'CC0-1.0' } }), /site/);
});
