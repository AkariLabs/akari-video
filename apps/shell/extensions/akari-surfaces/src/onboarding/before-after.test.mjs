import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { BEFORE_AFTER_DATA_URL } = require('../../lib/onboarding/before-after-data.js');
const { BEFORE_AFTER_IMAGE } = require('../../lib/onboarding/asset-paths.js');

test('招待の図は 1200×500、200KB 以下で、埋め込みと同じ内容', () => {
    const bytes = readFileSync(join(import.meta.dirname, BEFORE_AFTER_IMAGE.split(/[\\/]/).at(-1)));
    assert.ok(bytes.length <= 200 * 1024);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(bytes.readUInt16LE(26), 1200);
    assert.equal(bytes.readUInt16LE(28), 500);
    assert.deepEqual(Buffer.from(BEFORE_AFTER_DATA_URL.slice('data:image/webp;base64,'.length), 'base64'), bytes);
});
