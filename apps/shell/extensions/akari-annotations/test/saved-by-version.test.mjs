import assert from 'node:assert/strict';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

test('shell writer uses the same ApplicationServer version as the frontend and resolves it once', async () => {
  const service = new AkariAnnotationsServiceImpl();
  let calls = 0;
  service.applicationServer = {
    getApplicationInfo: async () => { calls++; return { name: 'AKARI Video', version: '0.1.86' }; }
  };
  const first = service.shellWriterVersion();
  const second = service.shellWriterVersion();
  assert.strictEqual(first, second);
  assert.equal(await first, '0.1.86');
  assert.equal(await service.shellWriterVersion(), '0.1.86');
  assert.equal(calls, 1);
});
