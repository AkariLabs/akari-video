import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
    join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);

const resolveStreamVideoUri = source.match(
    /protected async resolveStreamVideoUri\([\s\S]*?\n    \}/
)?.[0];

test('v2 and every matching sources[] entry use explicit proxy before generated fallback', () => {
    assert.ok(resolveStreamVideoUri, 'resolveStreamVideoUri implementation is present');
    assert.match(resolveStreamVideoUri, /resolvePreferredVideoUri/);
    assert.match(resolveStreamVideoUri, /model\.sourcesById\?\.values\(\)/);
    assert.match(resolveStreamVideoUri, /cachedProxyUri/);
    assert.doesNotMatch(resolveStreamVideoUri, /model\.sourceProxyUri/);
    assert.match(source, /proxyUri = await this\.fileService\.exists\(candidate\) \? candidate : undefined/);
    assert.match(source, /source across v0\/v1\/v2/);
});

test('tracks items projected as video layers route through proxy resolution and retain fallback identity', () => {
    assert.match(source, /await this\.resolveStreamVideoUri\(sourceUri, \{ sourcesById \}\)/);
    assert.match(source, /createAssetStream\(\{ assetUri: key \}\)/);
    assert.match(source, /sourceUri: sourceUri\.toString\(\)/);
    assert.match(source, /attemptHevcFallback\(errorCode, layer\.sourceUri\)/);
});

test('layer and source-swapped video errors send the failed original URI through the existing fallback request', () => {
    assert.match(source, /resolveHevcFallback: \(errorCode, videoUri\)/);
    assert.match(source, /'akari-preview-hevc-fallback-request', requestId, errorCode/);
    assert.match(source, /videoSourceUris: Object\.fromEntries/);
    assert.match(source, /initial\.videoSourceUris\[sourceId\] \|\| initial\.videoUri/);
    assert.match(source, /widget\.akariPreviewFallbackSourceUris\?\.has\(request\.videoUri\)/);
    assert.match(source, /videoUri = new URI\(request\.videoUri\)/);
    assert.match(source, /this\.queueRefresh\(widget, identityUri, kind, widget\.akariPreviewLastKnownTime, true\)/);
});
