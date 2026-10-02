import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const entrypoints = [
  ['packages/render-cut/src/caption-resolve.mjs', 'loadTextstyleCatalogSync'],
  ['packages/gpu-export/src/page-builder.mjs', 'loadTextstyleCatalogSync'],
  ['packages/osr-export/src/page-builder.mjs', 'loadTextstyleCatalogSync'],
  ['packages/preview-server/src/server.mjs', 'loadTextstyleCatalogSync'],
  ['apps/shell/extensions/akari-preview/src/node/akari-preview-service.ts', 'loadTextstyleCatalogSync'],
  ['apps/shell/extensions/akari-preview/src/browser/akari-preview-captions.ts', 'resolveTextstyleCatalog'],
  ['packages/edit-store/src/caption-store.ts', 'resolveTextstyleCatalog'],
];

function* sources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['generated', 'lib', 'public', 'node_modules'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:mjs|js|ts|tsx)$/u.test(entry.name)) yield path;
  }
}

test('all caption preset entrypoints use the merged catalog', () => {
  for (const [path, resolver] of entrypoints) {
    const source = readFileSync(join(repo, path), 'utf8');
    assert.match(source, new RegExp(`\\b${resolver}\\b`, 'u'), path);
    assert.match(source, /applyCaptionStylePresets\(/u, path);
    assert.doesNotMatch(source, /applyCaptionStylePresets\([^;]*?,\s*TEXTSTYLE_CATALOG\s*\)/su, path);
  }
  for (const scope of ['apps', 'packages']) {
    for (const path of sources(join(repo, scope))) {
      if (!path.includes(`${sep}src${sep}`)) continue;
      const source = readFileSync(path, 'utf8');
      assert.doesNotMatch(source, /applyCaptionStylePresets\([^;]*?,\s*TEXTSTYLE_CATALOG\s*\)/su, path);
    }
  }
});
