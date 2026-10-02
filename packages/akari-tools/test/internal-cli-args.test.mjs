// akari internal 系 CLI の引数まわりの回帰テスト。
// 2026-09-14 の同梱（internal-cli-packaging）で、5 本とも配布形から起動できるようになった直後に
// 「素で叩くと動かない」既存バグが 2 件見つかったため、その再発を止める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin');

test('render-when-idle.mjs: project と追加引数を Node 子プロセスへ転送する', () => {
  const script = readFileSync(join(binDir, 'render-when-idle.mjs'), 'utf8');
  assert.match(script, /spawnSync/);
  assert.match(script, /process\.execPath/);
  assert.match(script, /\[options\.renderCut \?\? DEFAULT_RENDER_CUT, project, \.\.\.extra\]/);
});

test('probe-frame.mjs: --flatten が無いときに第 1 引数（プロジェクト）を落とさない', () => {
  // 修正前は flattenIndex = -1 のとき flattenIndex + 1 = 0 となり、
  // positional フィルタが添字 0 = プロジェクトパスを捨てていた（常に usage で終了）。
  const parse = (args) => {
    const flattenIndex = args.indexOf('--flatten');
    const flattenValueIndex = flattenIndex >= 0 ? flattenIndex + 1 : -1;
    const positional = args.filter((a, i) => i !== flattenIndex && i !== flattenValueIndex);
    return {
      projectRoot: positional[0] ?? '.',
      times: positional.slice(1).map(Number).filter((n) => Number.isFinite(n)),
      flatten: flattenIndex >= 0 ? (args[flattenIndex + 1] ?? '#000000') : null
    };
  };

  assert.deepEqual(parse(['proj', '1.5', '2.5']),
    { projectRoot: 'proj', times: [1.5, 2.5], flatten: null });
  assert.deepEqual(parse(['proj', '1.5', '--flatten', '#ff0000']),
    { projectRoot: 'proj', times: [1.5], flatten: '#ff0000' });
  assert.deepEqual(parse(['--flatten', '#00ff00', 'proj', '1.5']),
    { projectRoot: 'proj', times: [1.5], flatten: '#00ff00' });

  // 実ファイルが同じ解析をしていること（テストの写しが本体から乖離しないように）。
  const source = readFileSync(join(binDir, 'probe-frame.mjs'), 'utf8');
  assert.match(source, /const flattenValueIndex = flattenIndex >= 0 \? flattenIndex \+ 1 : -1;/);
  assert.match(source, /i !== flattenIndex && i !== flattenValueIndex/);
});
