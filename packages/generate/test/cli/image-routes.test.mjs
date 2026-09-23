import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAgyImage } from '../../src/cli/agy-image.mjs';
import { generateGrokImage } from '../../src/cli/grok-image.mjs';

const bin = new URL('../../../../apps/shell/extensions/akari-annotations/test/fixtures/ai-still-routes-bin/', import.meta.url).pathname;
for (const [route, generate, executable] of [['agy', generateAgyImage, 'agy'], ['grok', generateGrokImage, 'grok']]) {
  test(`${route} の引数、PNG、鍵を外した環境`, async () => {
    const dir = await mkdtemp(join(tmpdir(), `akari-${route}-`));
    try {
      const log = join(dir, 'log.jsonl');
      const result = await generate({ projectDir: dir, item: { id: 'one', path: 'image.png', prompt: 'garden\n\n横長 16:9 の画像。' }, aspect: '16:9',
        env: { ...process.env, [`AKARI_${route === 'agy' ? 'AGY' : 'GROK'}_BIN`]: join(bin, executable), FAKE_IMAGE_LOG: log,
          FAL_KEY: 'secret', GROQ_API_KEY: 'secret', OPENAI_API_KEY: 'secret', GEMINI_API_KEY: 'secret', GOOGLE_API_KEY: 'secret', XAI_API_KEY: 'secret' } });
      assert.equal(result.ok, true, result.error);
      assert.equal((await readFile(join(dir, 'image.png'))).subarray(1, 4).toString('ascii'), 'PNG');
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.deepEqual(calls[0].keys, []);
      assert.equal(calls[0].args[0], '-p');
      assert.match(calls[0].args[1], /絶対パス.*image\.png/u);
      if (route === 'agy') assert.ok(calls[0].args.includes('--print-timeout'));
      else {
        assert.ok(calls[0].args.includes('--output-format'));
        assert.match(calls[0].args[1], /aspect_ratio に 16:9/u);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
