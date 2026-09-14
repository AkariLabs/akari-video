// `akari internal` 系 5 本は launcher から子プロセス起動されるため、実行体と相対 import 閉包を
// electron-builder の extraResources 契約へ直接突き合わせる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BEATMAP_SCRIPT_RELATIVE,
  PROBE_FRAME_SCRIPT_RELATIVE,
  RENDER_WHEN_IDLE_SCRIPT_RELATIVE,
  EYE_BAR_SCRIPT_RELATIVE,
  FINGER_FRAME_SCRIPT_RELATIVE,
} from '../../../packages/akari-launcher/src/repo-assets.mjs';
import { collectImportSpecifiers, packagedRoots, resolvePackagedSpecifier } from './helpers/packaged-imports.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptRelatives = [
  BEATMAP_SCRIPT_RELATIVE,
  PROBE_FRAME_SCRIPT_RELATIVE,
  RENDER_WHEN_IDLE_SCRIPT_RELATIVE,
  EYE_BAR_SCRIPT_RELATIVE,
  FINGER_FRAME_SCRIPT_RELATIVE,
].map((relative) => relative.split(path.sep).join('/'));
const moduleRelatives = scriptRelatives.filter((relative) => relative.endsWith('.mjs'));

async function readShellPackageJson() {
  return JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
}

test('extraResources は akari internal 系 5 本の実行体を同梱する', async () => {
  const pkg = await readShellPackageJson();
  const toolsResource = pkg.build.extraResources.find(
    (resource) => resource.from === '../../packages/akari-tools' && resource.to === 'packages/akari-tools',
  );
  assert.ok(toolsResource, 'packages/akari-tools の extraResources 宣言が無い');

  for (const relative of scriptRelatives) {
    const insidePackage = relative.replace(/^packages\/akari-tools\//, '');
    assert.ok(
      toolsResource.filter?.includes(insidePackage),
      `${insidePackage} が packages/akari-tools の filter に含まれていない`,
    );
    const sourcePath = path.resolve(shellRoot, toolsResource.from, insidePackage);
    assert.ok((await stat(sourcePath)).isFile(), `同梱元ファイルが存在しない: ${sourcePath}`);
  }
});

test('akari internal 系 4 本の相対 import 閉包は同梱される場所だけを参照する', async () => {
  const pkg = await readShellPackageJson();
  const roots = packagedRoots(pkg.build.extraResources);
  const problems = [];
  const visited = new Set();
  const queue = moduleRelatives.map((relative) => ({
    sourcePath: path.resolve(shellRoot, '../..', relative),
    packagedPath: path.posix.join('resources', relative),
  }));

  // probe-frame.mjs は実行時に組み立てたパスを動的 import するため、入口を明示して以降を辿る。
  queue.push(
    {
      sourcePath: path.resolve(shellRoot, '../../packages/akari-tools/bin/avatar-vrm/find-chrome.mjs'),
      packagedPath: 'resources/packages/akari-tools/bin/avatar-vrm/find-chrome.mjs',
    },
    {
      sourcePath: path.resolve(shellRoot, '../../packages/render-cut/src/rasterize.mjs'),
      packagedPath: 'resources/packages/render-cut/src/rasterize.mjs',
    },
  );

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current.packagedPath)) continue;
    visited.add(current.packagedPath);
    for (const specifier of collectImportSpecifiers(await readFile(current.sourcePath, 'utf8'))) {
      // bare 指定子は scripts/release/check-packaged-imports.mjs が cli-node-modules と突き合わせる。
      if (!specifier.startsWith('.') && !specifier.startsWith('node:')) continue;
      const result = resolvePackagedSpecifier(specifier, {
        fromPackagedPath: current.packagedPath,
        roots,
        shellRoot,
      });
      if (!result.ok) problems.push(`${current.packagedPath}: ${result.specifier} — ${result.reason}`);
      else if (!result.builtin) queue.push({ sourcePath: result.sourcePath, packagedPath: result.packagedPath });
    }
  }

  for (const relative of moduleRelatives) {
    assert.ok(visited.has(path.posix.join('resources', relative)), `${relative} の入口を辿れない`);
  }
  for (const name of ['corners', 'gesture', 'hand-metrics', 'keyframes', 'timeline-map']) {
    assert.ok(
      visited.has(`resources/packages/akari-tools/bin/finger-frame/${name}.mjs`),
      `finger-frame/${name}.mjs を import 閉包で辿れない`,
    );
  }
  assert.deepEqual(problems, [], `同梱されない場所を参照する import がある:\n${problems.join('\n')}`);
});

test('render-when-idle.sh の render-cut 相対参照は同梱後レイアウトで解決できる', async () => {
  const pkg = await readShellPackageJson();
  const roots = packagedRoots(pkg.build.extraResources);
  const relative = RENDER_WHEN_IDLE_SCRIPT_RELATIVE.split(path.sep).join('/');
  const sourcePath = path.resolve(shellRoot, '../..', relative);
  const source = await readFile(sourcePath, 'utf8');
  const renderCutSpecifier = '../../render-cut/bin/render-cut.mjs';

  assert.match(source, /RENDER_CUT="\$SCRIPT_DIR\/\.\.\/\.\.\/render-cut\/bin\/render-cut\.mjs"/u);
  const result = resolvePackagedSpecifier(renderCutSpecifier, {
    fromPackagedPath: path.posix.join('resources', relative),
    roots,
    shellRoot,
  });
  assert.ok(result.ok, result.reason);
  assert.equal(result.packagedPath, 'resources/packages/render-cut/bin/render-cut.mjs');
});
