// postpackage 検収スクリプト（resources/scripts/verify-asar-contents.mjs）の回帰テスト。
//
// 発端は issue #5 の Windows 実機報告: 修正自体は効いていたのに、検収の rgPath 検査だけが
// win32 で false-fail し、配布可能なパッケージが exit 1（配布禁止）と誤判定されていた。
// 「検収ゲート自身が縮退する」類の壊れ方であり、mac では原理的に再現しないため、
// OS 非依存の形で不変条件を固定しておく。
//
// 機構（実測で確定）:
//   旧実装は `execSync(\`npx @electron/asar extract-file ... ${JSON.stringify(key)}\`)` の形で
//   アーカイブ内キーをシェル経由で渡していた。win32 では path.join が 'lib\backend\main.js'
//   を返し、JSON.stringify がバックスラッシュを '\\' へエスケープする。cmd.exe は二重引用符
//   しか剥がさずバックスラッシュのエスケープを解釈しないため、CLI には区切りが二重化した
//   文字列が届く。@electron/asar のアーカイブ内検索は path.sep 分割（filesystem.js の
//   searchNodeFromPath）なので、空セグメントが混入して miss する。
//   posix は path.sep が '/' でエスケープ対象が無いため無傷 = mac で露見しなかった。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackage, extractFile } from '@electron/asar';

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../resources/scripts');
const verifyScriptPath = path.join(scriptsDir, 'verify-asar-contents.mjs');

// 旧実装がアーカイブ内キーに施していた変換の再現:
// JSON.stringify でエスケープ → cmd.exe / sh が「二重引用符だけを剥がす」段を通す。
function shellRoundTrip(pathFlavor) {
  const key = pathFlavor.join('lib', 'backend', 'main.js');
  const quoted = JSON.stringify(key);
  return quoted.slice(1, -1); // 引用符のみ除去（バックスラッシュのエスケープは解釈されない）
}

test('シェル引用の往復は win32 でアーカイブ内キーを破壊する（posix は無傷）', () => {
  // posix: 変化しない → mac で露見しなかった理由
  assert.equal(shellRoundTrip(path.posix), path.posix.join('lib', 'backend', 'main.js'));

  // win32: 区切りが二重化し、本来のキーと一致しなくなる
  const win32Key = path.win32.join('lib', 'backend', 'main.js');
  assert.equal(win32Key, 'lib\\backend\\main.js');
  assert.equal(shellRoundTrip(path.win32), 'lib\\\\backend\\\\main.js');
  assert.notEqual(shellRoundTrip(path.win32), win32Key);
});

test('検収スクリプトは asar 操作をシェル経由で呼ばない', async () => {
  const rawSource = await readFile(verifyScriptPath, 'utf8');
  // 行コメントを除いてから走査する（対象ファイルの注釈は全て行頭 `//` 形式で、
  // そこには機構の説明として execSync 等の語がそのまま登場するため）。
  const source = rawSource
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n');

  // シェル層を挟むと引用・区切りの解釈段が復活し、上記の破壊が再発する。
  assert.ok(
    !/execSync|execFileSync|spawnSync/.test(source),
    'verify-asar-contents.mjs がシェル実行を再導入している（issue #5 の win32 false-fail が再発する）'
  );
  assert.ok(
    !/npx[^\n]*@electron\/asar/.test(source),
    'verify-asar-contents.mjs が @electron/asar を CLI 経由で叩いている'
  );
  // API を直接 import していること
  assert.ok(
    /from\s+'@electron\/asar'/.test(source),
    'verify-asar-contents.mjs が @electron/asar を直接 import していない'
  );
});

test('extractFile は path.join のキーで取り出せ、区切り二重化では miss する', async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'akari-asar-key-test-'));
  try {
    const srcDir = path.join(workDir, 'src');
    await mkdir(path.join(srcDir, 'lib', 'backend'), { recursive: true });
    const marker = 'rgPath.replace(/app\\.asar([\\\\/])/, "app.asar.unpacked$1")';
    await writeFile(path.join(srcDir, 'lib', 'backend', 'main.js'), marker, 'utf8');
    const archive = path.join(workDir, 'app.asar');
    await createPackage(srcDir, archive);

    // 検収スクリプトが実際に使うキーの作り方（path.sep 分割に一致させるため path.join のまま）
    const key = path.join('lib', 'backend', 'main.js');
    const extracted = extractFile(archive, key).toString('utf8');
    assert.equal(extracted, marker);
    assert.ok(extracted.includes('app.asar.unpacked$1'));

    // 区切りが二重化したキー（= 旧実装が win32 で渡していた形）は見つからない
    const doubledKey = key.split(path.sep).join(path.sep + path.sep);
    assert.throws(
      () => extractFile(archive, doubledKey),
      /was not found in this archive/,
      '区切り二重化キーが通ってしまうと、この回帰テストは機構を捉えていない'
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
