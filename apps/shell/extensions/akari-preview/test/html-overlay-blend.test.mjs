import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const osr = readFileSync(new URL('../../../../../packages/osr-export/src/page-builder.mjs', import.meta.url), 'utf8');

function entries(source, declaration) {
    const body = source.match(new RegExp(`const ${declaration} = new Map(?:<[^>]+>)?\\(\\[([\\s\\S]*?)\\]\\);`))?.[1];
    assert.ok(body, `${declaration} mapping is present`);
    return new Map([...body.matchAll(/\['([^']+)', '([^']+)'\]|\["([^"]+)", "([^"]+)"\]/g)]
        .map(match => [match[1] ?? match[3], match[2] ?? match[4]]));
}

test('HTML overlay blend mapping exactly matches OSR', () => {
    const shellMap = entries(shell, 'LAYER_BLEND_TO_CSS');
    const osrMap = entries(osr, 'blendModes');
    assert.equal(shellMap.size, 10);
    assert.deepEqual([...shellMap], [...osrMap]);
});

test('HTML summary and mounted item use the shared map with normal fallback', () => {
    assert.match(shell, /LAYER_BLEND_TO_CSS\.get\(declaredBlend\) \?\? 'normal'/);
    assert.match(shell, /container\.style\.mixBlendMode = overlay\?\.blend \|\| 'normal'/);
    assert.match(shell, /unsupportedBlendCount \+= 1;[\s\S]*?console\.warn\(`\[akari-preview\] HTML overlay/);
});
