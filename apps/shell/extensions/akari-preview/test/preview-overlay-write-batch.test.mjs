import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
};
test('batch handler reads, resolves, lints and writes once in that order', () => {
  const handler = section('    protected async handleOverlayWriteBatch(', '    protected isOverlayWriteBatchRequest(');
  for (const call of ['this.readText(', 'resolvePreviewItemWriteBatch(', 'this.previewService.lintEditCandidate(', 'this.fileService.writeFile(']) {
    assert.equal(handler.split(call).length - 1, 1, call);
  }
  assert.ok(handler.indexOf('resolvePreviewItemWriteBatch(') < handler.indexOf('lintEditCandidate('));
  assert.ok(handler.indexOf('if (!lintResult.pass) throw') < handler.indexOf('this.fileService.writeFile('));
  assert.match(handler, /catch \(error\)[\s\S]*ok: false/);
  assert.match(handler, /type: 'akari-preview-overlay-write-batch-response'[\s\S]*ok: true/);
});
test('single and batch handlers share the host serialization queue', () => {
  assert.match(source, /if \(this\.isOverlayWriteRequest\(message\)\) \{\s*this\.overlayWriteTail = this\.overlayWriteTail\.then\(\(\) => this\.handleOverlayWrite\(widget, message\)\);/);
  assert.match(source, /if \(this\.isOverlayWriteBatchRequest\(message\)\) \{\s*this\.overlayWriteTail = this\.overlayWriteTail\.then\(\(\) => this\.handleOverlayWriteBatch\(widget, message\)\);/);
});
test('batch guard requires nonempty writes and object patches; bridge matches pending response kind', () => {
  const guard = section('    protected isOverlayWriteBatchRequest(', '    protected isOverlayWriteRequest(');
  assert.match(guard, /Array\.isArray\(message\.writes\) && message\.writes\.length > 0/);
  assert.match(guard, /typeof message\.requestId === 'string'/);
  assert.match(guard, /typeof write\.overlayId === 'string'/);
  assert.match(guard, /!Array\.isArray\(write\.patch\)/);
  const bridge = section('                overlayWriteBatch:', '                overlayWrite:');
  assert.match(bridge, /const requestId = 'akari-preview-' \+ \(\+\+sequence\)/);
  assert.match(bridge, /pending\.set\(requestId, \{ kind: 'overlay-write-batch', resolve, reject \}\)/);
  assert.match(bridge, /vscode\.postMessage\(\{ type: 'akari-preview-overlay-write-batch', requestId, writes \}\)/);
  assert.match(source, /'overlay-write-batch': 'akari-preview-overlay-write-batch-response'/);
});
