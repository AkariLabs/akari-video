// akari internal 系 CLI の引数まわりの回帰テスト。
// 2026-09-14 の同梱（internal-cli-packaging）で、5 本とも配布形から起動できるようになった直後に
// 「素で叩くと動かない」既存バグが 2 件見つかったため、その再発を止める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const binDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin');

test('render-when-idle.sh: 引数なしでも bash 3.2 + set -u で unbound にならない', () => {
  const script = readFileSync(join(binDir, 'render-when-idle.sh'), 'utf8');
  // set -u のもとで空配列を "${A[@]}" と展開すると bash 3.2（macOS 既定）は
  // 「A[@]: unbound variable」で落ちる。${A[@]+"${A[@]}"} なら空でも安全。
  assert.match(script, /\$\{EXTRA\[@\]\+"\$\{EXTRA\[@\]\}"\}/,
    'EXTRA の展開が bash 3.2 安全形になっていること');
  assert.doesNotMatch(script, /node "\$RENDER_CUT" "\$PROJECT" "\$\{EXTRA\[@\]\}"/,
    '素の "${EXTRA[@]}" 展開が復活していないこと');

  // 実際に bash 3.2 の意味論で確かめる（同じ書き方が空配列で通ること）。
  const empty = spawnSync('/bin/bash', ['-c', 'set -u; A=(); printf "%s" "ok[${A[@]+"${A[@]}"}]"'], { encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, 'ok[]');

  // 引数が渡されたときは、空白を含むものも 1 語として保たれること。
  const filled = spawnSync('/bin/bash', ['-c', 'set -u; A=("a b" c); printf "[%s]" ${A[@]+"${A[@]}"}'], { encoding: 'utf8' });
  assert.equal(filled.status, 0, filled.stderr);
  assert.equal(filled.stdout, '[a b][c]');
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
