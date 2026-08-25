import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const NodeModule = require('node:module');
const URI = require('@theia/core/lib/common/uri').default;
const originalLoad = NodeModule._load;
let AkariFileResourceResolver;
let isSuppressedBinaryExtension;

class StubFileResourceResolver {
    async shouldOpenAsText() {
        return true;
    }
}

try {
    NodeModule._load = function (request, parent, isMain) {
        if (request === '@theia/filesystem/lib/browser/file-resource') {
            return { FileResourceResolver: StubFileResourceResolver };
        }
        if (request === '@theia/core/shared/inversify') {
            return { injectable: () => target => target };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    ({
        AkariFileResourceResolver,
        isSuppressedBinaryExtension
    } = require('../lib/browser/akari-file-resource-resolver.js'));
} finally {
    NodeModule._load = originalLoad;
}

test('known binary extensions are suppressed case-insensitively', () => {
    for (const extension of ['.png', '.mp4', '.wav', '.glb', '.PNG']) {
        assert.equal(isSuppressedBinaryExtension(extension), true, extension);
    }
});

test('text and missing extensions are not suppressed', () => {
    for (const extension of ['.md', '.json', '.txt', '.ts', '']) {
        assert.equal(isSuppressedBinaryExtension(extension), false, extension || '(no extension)');
    }
});

test('known binary URI returns false without entering the dialog path', async () => {
    let dialogPathCalls = 0;
    StubFileResourceResolver.prototype.shouldOpenAsText = async () => {
        dialogPathCalls += 1;
        return true;
    };

    const resolver = new AkariFileResourceResolver();
    const result = await resolver.shouldOpenAsText(new URI('file:///project/frame.png'), 'binary file');

    assert.equal(result, false);
    assert.equal(dialogPathCalls, 0);
});

test('unknown extension delegates to the original dialog path', async () => {
    let dialogPathCalls = 0;
    StubFileResourceResolver.prototype.shouldOpenAsText = async () => {
        dialogPathCalls += 1;
        return true;
    };

    const resolver = new AkariFileResourceResolver();
    const result = await resolver.shouldOpenAsText(new URI('file:///project/notes.txt'), 'too large');

    assert.equal(result, true);
    assert.equal(dialogPathCalls, 1);
});

test('frontend module rebinds the Theia file resource resolver', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-frontend-module.ts', import.meta.url), 'utf8');
    assert.match(
        source,
        /rebind\(FileResourceResolver\)\.to\(AkariFileResourceResolver\)\.inSingletonScope\(\)/
    );
});
