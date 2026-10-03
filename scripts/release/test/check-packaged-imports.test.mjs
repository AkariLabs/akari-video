import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { isDeclaredResource, relativeRequires, scanAssetFinderCalls, walkImports } from '../check-packaged-imports.mjs';
import { packagedRoots, resolvePackagedSpecifier } from '../../../apps/shell/test/helpers/packaged-imports.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'packaged-imports-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('createRequire の相対 JSON を検出し、実在だけ検査する', (t) => {
  const resources = fixture(t);
  const cli = path.join(resources, 'packages', 'generate', 'src', 'cli');
  mkdirSync(cli, { recursive: true });
  const entry = path.join(cli, 'fal-still.mjs');
  const source = "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nrequire('../../../schemas/ai-models.json');";
  writeFileSync(entry, source);
  assert.deepEqual(relativeRequires(source), ['../../../schemas/ai-models.json']);
  const absent = walkImports([entry], resources);
  assert.deepEqual(absent.missing.map((item) => item.specifier), ['packages/schemas/ai-models.json']);
  const schema = path.join(resources, 'packages', 'schemas', 'ai-models.json');
  mkdirSync(path.dirname(schema), { recursive: true });
  writeFileSync(schema, '{}');
  const present = walkImports([entry], resources);
  assert.deepEqual(present.missing, []);
  assert.equal(present.walked, 1, 'JSON の中身は辿らない');
});

test('backend finder の文字列だけ検査し、テンプレートと変数は参考にする', (t) => {
  const dir = fixture(t);
  const repoRoot = path.join(dir, 'repo');
  const resourcesRoot = path.join(dir, 'Resources');
  const nodeDir = path.join(repoRoot, 'apps/shell/extensions/example/src/node');
  mkdirSync(nodeDir, { recursive: true });
  mkdirSync(resourcesRoot);
  writeFileSync(path.join(nodeDir, 'service.ts'), [
    "this.findGenerationAsset('packages/schemas/ai-models.json');",
    "this.findAsset('packages/generate/src/cli/meta-still.mjs');",
    'this.findAsset(`packages/generate/src/cli/${name}.mjs`);',
    'this.findGenerationAsset(variable);',
  ].join('\n'));
  mkdirSync(path.join(resourcesRoot, 'packages/generate/src/cli'), { recursive: true });
  writeFileSync(path.join(resourcesRoot, 'packages/generate/src/cli/meta-still.mjs'), '');
  const result = scanAssetFinderCalls({ repoRoot, resourcesRoot });
  assert.equal(result.found, 2);
  assert.deepEqual(result.missing.map((item) => item.specifier), ['packages/schemas/ai-models.json']);
  assert.equal(result.dynamic.length, 2);
  assert.equal(result.missing[0].line, 1);
  const generated = scanAssetFinderCalls({ repoRoot, resourcesRoot, generatedResources: [
    { from: 'generated/schema', to: 'packages/schemas', filter: ['ai-models.json'] },
  ] });
  assert.deepEqual(generated.missing, [], 'checkout にない生成物は宣言で足りる');
});

test('checkout にない生成物は to と filter の宣言で判定する', () => {
  const entries = [{ from: 'native/bin', to: 'native/bin', filter: ['akari-photo-mask*'] }];
  assert.equal(isDeclaredResource('native/bin/akari-photo-mask', entries), true);
  assert.equal(isDeclaredResource('native/bin/unrelated', entries), false);
  assert.equal(isDeclaredResource('packages/schemas/ai-models.json', entries), false);
});

test('実際の extraResources は同梱後の ai-models.json を解決する', () => {
  const shellRoot = path.join(root, 'apps/shell');
  const shellPackage = JSON.parse(readFileSync(path.join(shellRoot, 'package.json'), 'utf8'));
  const result = resolvePackagedSpecifier('../../../schemas/ai-models.json', {
    fromPackagedPath: 'resources/packages/generate/src/cli/fal-still.mjs',
    roots: packagedRoots(shellPackage.build.extraResources),
    shellRoot,
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.packagedPath, 'resources/packages/schemas/ai-models.json');
});

test('正規表現と複数行テンプレートの後にある finder と require の呼び出しも検出する', (t) => {
  const dir = fixture(t);
  const repoRoot = path.join(dir, 'repo');
  const resourcesRoot = path.join(dir, 'Resources');
  const nodeDir = path.join(repoRoot, 'apps/shell/extensions/example/src/node');
  mkdirSync(nodeDir, { recursive: true });
  mkdirSync(resourcesRoot);
  const source = [
    'const tokens = /"(?:\\\\.|[^"\\\\])*"|[{}[\\]:,]|[^\\s{}[\\]:,]+/gu;',
    'const label = `first line ${"quoted value"}',
    'second line ${name}`;',
    "this.findGenerationAsset('packages/schemas/ai-models.json');",
    "this.findAsset('packages/generate/src/cli/meta-still.mjs');",
    "require('./relative.mjs');",
    'class Finder { protected async findGenerationAsset(relativeTarget: string): Promise<string> { return relativeTarget; } }',
  ].join('\n');
  writeFileSync(path.join(nodeDir, 'service.ts'), source);
  const result = scanAssetFinderCalls({ repoRoot, resourcesRoot });
  assert.equal(result.found, 2);
  assert.deepEqual(result.missing.map(row => row.specifier), [
    'packages/schemas/ai-models.json', 'packages/generate/src/cli/meta-still.mjs',
  ]);
  assert.equal(result.dynamic.length, 0, 'メソッド宣言は呼び出しとして数えない');
  assert.deepEqual(relativeRequires(source), ['./relative.mjs']);
});

test('ルート配置先の object と string の宣言で生成ファイルを判定する', () => {
  assert.equal(isDeclaredResource('resources/generated-notices/note.txt', [
    { from: 'resources/generated-notices', to: '.' },
  ]), true);
  assert.equal(isDeclaredResource('resources/generated-notices/note.txt', ['resources/generated-notices']), true);
  assert.equal(isDeclaredResource('other/note.txt', [
    { from: 'resources/generated-notices', to: '.', filter: ['resources/generated-notices/**'] },
  ]), false);
});

test('実際の backend finder 走査件数は独立した呼び出し件数と一致する', () => {
  const extensions = path.join(root, 'apps/shell/extensions');
  const files = [];
  const walk = dir => {
    for (const row of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, row.name);
      if (row.isDirectory()) walk(file);
      else if (file.replaceAll('\\', '/').includes('/src/node/') && file.endsWith('.ts')) files.push(file);
    }
  };
  walk(extensions);
  const independent = files.reduce((total, file) => {
    const source = readFileSync(file, 'utf8');
    let count = 0;
    for (const match of source.matchAll(/(?<![\w$])(?:findGenerationAsset|findAsset)\s*\(/gu)) {
      const before = source.slice(source.lastIndexOf('\n', match.index - 1) + 1, match.index);
      if (/^\s*(?:\/\/|\/\*|\*)/u.test(before)) continue;
      if (/\b(?:function|protected|private|public|static|async)\s+$/u.test(before)) continue;
      count += 1;
    }
    return total + count;
  }, 0);
  const result = scanAssetFinderCalls({ repoRoot: root, resourcesRoot: path.join(root, 'apps/shell') });
  assert.ok(independent > 0);
  assert.equal(result.found + result.dynamic.length, independent);
});

test('同梱 import の検査は Node と相対モジュールだけを使う', () => {
  const source = readFileSync(new URL('../check-packaged-imports.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s*)?['"]([^'"]+)['"]/gmu)]
    .map(row => row[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every(specifier => specifier.startsWith('node:') || specifier.startsWith('./')
    || specifier.startsWith('../')), imports.join(', '));
  assert.doesNotMatch(source, /createRequire|typescript/u);
});
