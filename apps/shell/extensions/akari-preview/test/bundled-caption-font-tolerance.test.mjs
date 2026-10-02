import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');
const { BUNDLED_CAPTION_FONT_FACES } = require('../lib/common/bundled-caption-fonts.js');

test('one missing bundled font is skipped, warned once, and retried later', () => {
    const root = mkdtempSync(join(tmpdir(), 'akari-font-tolerance-'));
    const missing = BUNDLED_CAPTION_FONT_FACES[0];
    const missingKey = (missing.sourceId ?? missing.id) + '/' + missing.file;
    const missingPath = join(root, missing.sourceId ?? missing.id, missing.file);
    const warnings = [];
    const originalWarn = console.warn;
    const service = Object.create(AkariPreviewServiceImpl.prototype);
    service.bundledCaptionFontWarnings = new Set();
    service.findFontAssetPath = relativePath => join(root, ...relativePath.split(/[\\/]/u).slice(2));
    try {
        for (const face of BUNDLED_CAPTION_FONT_FACES.slice(1)) {
            const path = join(root, face.sourceId ?? face.id, face.file);
            mkdirSync(join(root, face.sourceId ?? face.id), { recursive: true });
            writeFileSync(path, Buffer.from('font:' + face.id));
        }
        console.warn = (...args) => warnings.push(args);
        const first = service.loadBundledCaptionFontBuffers();
        assert.equal(first.size, BUNDLED_CAPTION_FONT_FACES.length - 1);
        assert.equal(first.has(missingKey), false);
        assert.equal(warnings.length, 1);
        assert.equal(service.loadBundledCaptionFontBuffers().size, first.size);
        assert.equal(warnings.length, 1);
        mkdirSync(join(root, missing.sourceId ?? missing.id), { recursive: true });
        writeFileSync(missingPath, Buffer.from('recovered font'));
        const recovered = service.loadBundledCaptionFontBuffers();
        assert.equal(recovered.size, BUNDLED_CAPTION_FONT_FACES.length);
        assert.equal(recovered.get(missingKey).toString(), 'recovered font');
        assert.equal(warnings.length, 1);
    } finally {
        console.warn = originalWarn;
        rmSync(root, { recursive: true, force: true });
    }
});
