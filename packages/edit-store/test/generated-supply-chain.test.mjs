import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const expectedSources = [
  'audio-schedule.ts',
  'canonical.ts',
  'caption-display.ts',
  'caption-store.ts',
  'caption-window.ts',
  'cut-adjacency.ts',
  'ducking.ts',
  'edit-store.ts',
  'edit-v2-item-write.ts',
  'edit-v2.ts',
  'index.ts',
  'internal-model.ts',
  'legacy-audio-view.ts',
  'project.ts',
  'retime.ts',
  'timeline-map.ts',
  'track-order.ts',
  'track-transition-compatibility.ts',
  'transition-visual.ts',
  'transition-vocabulary.ts',
  'webview-kernel.ts',
  'write-gate.ts',
];

test('checked generated surfaces have the exact source list and deterministic bytes', async () => {
  assert.deepEqual((await readdir(join(packageRoot, 'src'))).filter(name => name.endsWith('.ts')).sort(), expectedSources);
  const expectedLibraryFiles = expectedSources.flatMap(name => {
    const stem = name.slice(0, -3);
    return [`${stem}.d.ts`, `${stem}.js`];
  }).sort();
  assert.deepEqual((await readdir(join(packageRoot, 'lib'))).filter(name => /\.(?:d\.ts|js)$/u.test(name)).sort(), expectedLibraryFiles);

  const temporary = await mkdtemp(join(tmpdir(), 'akari-edit-store-supply-'));
  try {
    const tscOut = join(temporary, 'tsc');
    execFileSync(process.execPath, [
      join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
      '--project', join(packageRoot, 'tsconfig.json'),
      '--outDir', tscOut,
      '--incremental', 'false',
    ], { cwd: repositoryRoot, stdio: 'pipe' });

    for (const name of expectedLibraryFiles) {
      if (name === 'webview-kernel.js') continue;
      assert.equal(
        sha256(await readFile(join(tscOut, name))),
        sha256(await readFile(join(packageRoot, 'lib', name))),
        `${name} differs from a clean TypeScript generation`,
      );
    }

    // esbuild の bin は postinstall がネイティブバイナリへ置換する環境がある（macOS 等）。
    // `node <bin>` 起動は JS シム前提で壊れるため、直接実行する（シムは shebang で node に乗る）。
    const esbuild = join(repositoryRoot, 'node_modules/esbuild/bin/esbuild');
    const editStoreBundle = join(temporary, 'edit-store-webview.js');
    execFileSync(esbuild, ['src/webview-kernel.ts',
      '--bundle', '--format=iife', '--global-name=AkariEditKernel', `--outfile=${editStoreBundle}`,
      '--target=chrome122', '--platform=browser'], { cwd: packageRoot, stdio: 'pipe' });
    assert.equal(sha256(await readFile(editStoreBundle)), sha256(await readFile(join(packageRoot, 'lib/webview-kernel.js'))));

    // preview-server の ESM bundle は別所有の配布物であり、edit-store の変更単位では書き換えない。
    // この package が所有する IIFE bundle と tsc 出力の決定性だけをここで検証する。
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
